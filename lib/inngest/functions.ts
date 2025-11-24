import { and, eq, inArray } from 'drizzle-orm';
import type { InngestFunction } from 'inngest';
import OpenAI from 'openai';
import Replicate from 'replicate';

import {
  db,
  projects,
  scenes,
  type ImageModel,
  type SceneSection,
  type VideoModel,
} from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import { uploadImage, uploadVideo } from '@/lib/storage';

const STORYBOARD_MODEL =
  process.env.OPENAI_STORYBOARD_MODEL ?? 'gpt-4.1-mini';
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ProjectCreatedEvent = {
  name: 'project/created';
  data: {
    projectId: string;
    duration: number;
    tempo: number;
    beats: number[];
  };
};

type PlannedScene = {
  order: number;
  startTime: number;
  duration: number;
  startBeatIndex: number;
  endBeatIndex: number;
  section: SceneSection;
};

type StoryboardResponse = {
  scenes: {
    title: string;
    visualPrompt: string;
    cameraStyle?: string;
    motionCue?: string;
  }[];
};

type ProjectGenerateImagesEvent = {
  name: 'project/generate-images';
  data: {
    projectId: string;
  };
};

type ProjectGenerateVideoEvent = {
  name: 'project/generate-video';
  data: {
    projectId: string;
  };
};

const MIN_SCENE_DURATION = 3;
const MAX_SCENE_DURATION = 5;
const MAX_SCENES = 4;
const MIN_SCENES = 4;
const PLACEHOLDER_BACKGROUND = '0f172a';
const PLACEHOLDER_TEXT_COLOR = '94a3b8';

type ImageModelConfig = {
  slug: string;
  contentType: string;
  extension: string;
  buildInput: (prompt: string) => Record<string, unknown>;
};

type VideoModelConfig = {
  slug: string;
  buildInput: (args: {
    prompt: string;
    duration: number;
    imageUrl?: string | null;
  }) => Record<string, unknown>;
};

const IMAGE_MODEL_CONFIG: Record<ImageModel, ImageModelConfig> = {
  nano_banana: {
    slug: 'google/nano-banana-pro',
    contentType: 'image/png',
    extension: 'png',
    buildInput: (prompt) => ({
      prompt,
      resolution: '2K',
      aspect_ratio: '4:3',
      output_format: 'png',
      safety_filter_level: 'block_only_high',
    }),
  },
  imagen_fast: {
    slug: 'google/imagen-4-fast',
    contentType: 'image/jpeg',
    extension: 'jpg',
    buildInput: (prompt) => ({
      prompt,
      aspect_ratio: '4:3',
      output_format: 'jpg',
      safety_filter_level: 'block_only_high',
    }),
  },
};

const VIDEO_MODEL_CONFIG: Record<VideoModel, VideoModelConfig> = {
  seedance_fast: {
    slug: 'bytedance/seedance-1-pro-fast',
    buildInput: ({ prompt }) => ({
      prompt,
      fps: 24,
      duration: 5,
      resolution: '1080p',
      aspect_ratio: '16:9',
      camera_fixed: false,
    }),
  },
  kling_turbo: {
    slug: 'kwaivgi/kling-v2.5-turbo-pro',
    buildInput: ({ prompt }) => ({
      prompt,
      duration: 5,
      aspect_ratio: '16:9',
      negative_prompt: '',
    }),
  },
};

function buildPlaceholderImage(projectId: string, order: number) {
  const label = encodeURIComponent(`Scene ${order + 1}`);
  return `https://placehold.co/800x450/${PLACEHOLDER_BACKGROUND}/${PLACEHOLDER_TEXT_COLOR}.png?text=${label}&font=lato`;
}

function chunkBeatsIntoScenes(
  beats: number[],
  duration: number,
  tempo: number,
): PlannedScene[] {
  if (beats.length === 0) {
    return [
      {
        order: 0,
        startTime: 0,
        duration,
        startBeatIndex: 0,
        endBeatIndex: 0,
        section: 'INTRO',
      },
    ];
  }

  const beatInterval = 60 / Math.max(tempo, 1);
  const targetSceneDuration = 4;
  const beatsPerScene = Math.max(
    1,
    Math.round(targetSceneDuration / beatInterval),
  );

  const scenes: PlannedScene[] = [];
  let startIndex = 0;
  let order = 0;

  while (startIndex < beats.length && order < MAX_SCENES) {
    const endIndex = Math.min(startIndex + beatsPerScene - 1, beats.length - 1);
    const startTime = beats[startIndex];
    const estimatedEnd = beats[endIndex] + beatInterval;
    const rawDuration = Math.min(
      Math.max(estimatedEnd - startTime, MIN_SCENE_DURATION),
      MAX_SCENE_DURATION,
    );
    const clampedEnd = Math.min(startTime + rawDuration, duration);

    scenes.push({
      order,
      startTime: Number(startTime.toFixed(3)),
      duration: Number((clampedEnd - startTime).toFixed(3)),
      startBeatIndex: startIndex,
      endBeatIndex: endIndex,
      section: determineSection(order, duration),
    });

    order += 1;
    startIndex = endIndex + 1;
  }

  if (scenes.length >= MIN_SCENES) {
    return scenes;
  }

  const fallbackCount = Math.min(
    MAX_SCENES,
    Math.max(MIN_SCENES, Math.ceil(duration / 5)),
  );
  const fallback: PlannedScene[] = [];
  for (let i = 0; i < fallbackCount; i++) {
    const startTime = (duration / fallbackCount) * i;
    const endTime = Math.min(duration, startTime + duration / fallbackCount);
    fallback.push({
      order: i,
      startTime: Number(startTime.toFixed(3)),
      duration: Number((endTime - startTime).toFixed(3)),
      startBeatIndex: 0,
      endBeatIndex: 0,
      section: determineSection(i, duration),
    });
  }
  return fallback;
}

function determineSection(index: number, duration: number): SceneSection {
  if (index <= 1) {
    return 'INTRO';
  }

  const approxSceneCount = Math.max(3, Math.round(duration / 4));
  if (index >= approxSceneCount - 2) {
    return 'OUTRO';
  }

  const cycle = (index - 2) % 4;
  if (cycle === 0 || cycle === 1) {
    return 'VERSE';
  }
  if (cycle === 2) {
    return 'CHORUS';
  }
  return 'BRIDGE';
}

async function generateStoryboard(
  projectPrompt: string,
  stylePreset: string | null,
  energy: string | null,
  scenesData: PlannedScene[],
): Promise<StoryboardResponse> {
  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      scenes: {
        type: 'array',
        minItems: scenesData.length,
        maxItems: scenesData.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            visualPrompt: { type: 'string' },
          },
          required: ['title', 'visualPrompt'],
        },
      },
    },
    required: ['scenes'],
  } as const;

  const buildFallback = (): StoryboardResponse => ({
    scenes: scenesData.map((scene, idx) => ({
      title: `Scene ${idx + 1}`,
      visualPrompt: `${projectPrompt} · ${scene.section.toLowerCase()} focus`,
    })),
  });

  if (!process.env.OPENAI_API_KEY) {
    return buildFallback();
  }

  try {
    const response = await openai.responses.create({
      model: STORYBOARD_MODEL,
      temperature: 0.7,
      text: {
        format: {
          type: 'json_schema',
          schema: jsonSchema,
          name: 'StoryboardSceneList',
          strict: true,
        },
      },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You are The Director, an AI filmmaker planning visually cohesive music video scenes. Respond with detailed but concise visual prompts.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Song prompt: ${projectPrompt}`,
                stylePreset ? `Style preset: ${stylePreset}` : '',
                energy ? `Energy: ${energy}` : '',
                'Scene timing data:',
                JSON.stringify(scenesData),
                'Return JSON with vivid visualPrompt text and a short title for each scene in order.',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        },
      ],
    });

    const output = response.output_text;
    if (!output) {
      return buildFallback();
    }
    return JSON.parse(output) as StoryboardResponse;
  } catch (error) {
    console.error('openai-storyboard', error);
    return buildFallback();
  }
}

const planScenesFunction = inngest.createFunction(
  { id: 'project-plan-scenes', name: 'Plan scenes from beats' },
  { event: 'project/created' },
  async ({ event, step }) => {
    const { projectId, beats, duration, tempo } =
      (event as ProjectCreatedEvent).data;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const beatsSorted = [...beats].sort((a, b) => a - b);
  const scenesPlan = chunkBeatsIntoScenes(
    beatsSorted,
    duration,
    tempo || project.beatsSummary?.tempo || 120,
  );

    await db
      .update(projects)
      .set({ status: 'PLANNING' })
      .where(eq(projects.id, projectId));

    try {
      const storyboard = await step.run('openai-storyboard', async () =>
        generateStoryboard(
          project.prompt,
          project.stylePreset,
          project.energy,
          scenesPlan,
        ),
      );

      const sceneRecords = scenesPlan.map((scene, idx) => ({
        projectId,
        order: scene.order,
        startTime: scene.startTime,
        duration: scene.duration,
        startBeatIndex: scene.startBeatIndex,
        endBeatIndex: scene.endBeatIndex,
        section: scene.section,
        visualPrompt:
          storyboard.scenes?.[idx]?.visualPrompt ??
          `${project.prompt} - scene ${idx + 1}`,
        imageKeyframeUrl: buildPlaceholderImage(projectId, scene.order),
        status: 'PLANNED' as const,
      }));

      if (sceneRecords.length > 0) {
        await db.insert(scenes).values(sceneRecords);
      }

      await db
        .update(projects)
        .set({ status: 'GENERATING_IMAGES' })
        .where(eq(projects.id, projectId));
      await inngest.send({
        name: 'project/generate-images',
        data: { projectId },
      });
    } catch (error) {
      await db
        .update(projects)
        .set({ status: 'ERROR', error: (error as Error).message })
        .where(eq(projects.id, projectId));
      throw error;
    }
  },
);

const generateImagesFunction = inngest.createFunction(
  { id: 'project-generate-images', name: 'Generate scene keyframes' },
  { event: 'project/generate-images' },
  async ({ event, step }) => {
    const { projectId } = (event as ProjectGenerateImagesEvent).data;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      return;
    }

    const pendingScenes = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.projectId, projectId),
          inArray(scenes.status, ['PLANNED', 'IMAGE_PENDING']),
        ),
      )
      .limit(2);

    if (pendingScenes.length === 0) {
      await db
        .update(projects)
        .set({ status: 'GENERATING_VIDEO' })
        .where(eq(projects.id, projectId));
      await inngest.send({
        name: 'project/generate-video',
        data: { projectId },
      });
      return;
    }

    for (const scene of pendingScenes) {
      await step.run(`scene-${scene.id}`, async () => {
        await db
          .update(scenes)
          .set({ status: 'IMAGE_PENDING' })
          .where(eq(scenes.id, scene.id));

        const imageUrl =
          (await generateSceneImage(scene.visualPrompt, project.imageModel)) ??
          buildPlaceholderImage(projectId, scene.order);

        await db
          .update(scenes)
          .set({
            imageKeyframeUrl: imageUrl,
            status: 'IMAGE_DONE',
          })
          .where(eq(scenes.id, scene.id));
      });
    }

    await inngest.send({
      name: 'project/generate-images',
      data: { projectId },
    });
  },
);

const generateVideoFunction = inngest.createFunction(
  { id: 'project-generate-video', name: 'Generate motion clips' },
  { event: 'project/generate-video' },
  async ({ event, step }) => {
    const { projectId } = (event as ProjectGenerateVideoEvent).data;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      return;
    }

    const pendingScenes = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.projectId, projectId),
          inArray(scenes.status, ['IMAGE_DONE', 'VIDEO_PENDING']),
        ),
      )
      .limit(1);

    if (pendingScenes.length === 0) {
      await db
        .update(projects)
        .set({ status: 'COMPLETED' })
        .where(eq(projects.id, projectId));
      return;
    }

    for (const scene of pendingScenes) {
      await step.run(`video-scene-${scene.id}`, async () => {
        await db
          .update(scenes)
          .set({ status: 'VIDEO_PENDING' })
          .where(eq(scenes.id, scene.id));

        const videoUrl = await generateSceneVideo(
          scene.visualPrompt,
          project.videoModel,
          scene.duration,
        );

        if (!videoUrl) {
          throw new Error('Failed to generate video clip');
        }

        await db
          .update(scenes)
          .set({
            videoClipUrl: videoUrl,
            status: 'VIDEO_DONE',
          })
          .where(eq(scenes.id, scene.id));
      });
    }

    await inngest.send({
      name: 'project/generate-video',
      data: { projectId },
    });
  },
);

export const inngestFunctions: InngestFunction[] = [
  planScenesFunction,
  generateImagesFunction,
  generateVideoFunction,
];
async function generateSceneImage(prompt: string, model: ImageModel) {
  if (!process.env.REPLICATE_API_TOKEN) {
    return null;
  }

  const config = IMAGE_MODEL_CONFIG[model] ?? IMAGE_MODEL_CONFIG.nano_banana;

  try {
    const output = await replicate.run(config.slug, {
      input: config.buildInput(prompt),
    });

    let imageUrl: string | undefined;
    if (output && typeof output === 'object' && 'url' in output) {
      imageUrl = (output as { url: () => string }).url();
    } else if (typeof output === 'string') {
      imageUrl = output;
    } else if (Array.isArray(output)) {
      imageUrl = output.find((entry) => typeof entry === 'string') as
        | string
        | undefined;
    }

    if (!imageUrl) {
      return null;
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const uploaded = await uploadImage(buffer, {
      contentType: config.contentType,
      extension: config.extension,
    });

    return uploaded.url;
  } catch (error) {
    console.error('replicate-generate-image', error);
    return null;
  }
}

async function generateSceneVideo(
  prompt: string,
  model: VideoModel,
  duration: number,
) {
  if (!process.env.REPLICATE_API_TOKEN) {
    return null;
  }

  const config = VIDEO_MODEL_CONFIG[model] ?? VIDEO_MODEL_CONFIG.seedance_fast;

  try {
    const output = await replicate.run(config.slug, {
      input: config.buildInput({
        prompt,
        duration: Math.min(10, Math.max(3, Math.round(duration))),
      }),
    });

    let videoUrl: string | undefined;
    if (output && typeof output === 'object' && 'url' in output) {
      videoUrl = (output as { url: () => string }).url();
    } else if (typeof output === 'string') {
      videoUrl = output;
    } else if (Array.isArray(output)) {
      videoUrl = output.find((entry) => typeof entry === 'string') as
        | string
        | undefined;
    }

    if (!videoUrl) {
      return null;
    }

    const response = await fetch(videoUrl);
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const uploaded = await uploadVideo(buffer, {
      contentType: 'video/mp4',
      extension: 'mp4',
    });

    return uploaded.url;
  } catch (error) {
    console.error('replicate-generate-video', error);
    return null;
  }
}
