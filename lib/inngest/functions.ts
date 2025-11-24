import { eq } from 'drizzle-orm';
import type { InngestFunction } from 'inngest';
import OpenAI from 'openai';

import { db, projects, scenes, type SceneSection } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';

const STORYBOARD_MODEL =
  process.env.OPENAI_STORYBOARD_MODEL ?? 'gpt-4.1-mini';

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

const MIN_SCENE_DURATION = 3;
const MAX_SCENE_DURATION = 6;
const PLACEHOLDER_BACKGROUND = '0f172a';
const PLACEHOLDER_TEXT_COLOR = '94a3b8';

function buildPlaceholderImage(projectId: string, order: number) {
  const label = encodeURIComponent(`Scene ${order + 1}`);
  return `https://placehold.co/800x450/${PLACEHOLDER_BACKGROUND}/${PLACEHOLDER_TEXT_COLOR}?text=${label}&font=lato`;
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

  while (startIndex < beats.length) {
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

  return scenes;
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
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const schema = {
    name: 'StoryboardSceneList',
    schema: {
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
              cameraStyle: { type: 'string' },
              motionCue: { type: 'string' },
            },
            required: ['title', 'visualPrompt'],
          },
        },
      },
      required: ['scenes'],
    },
  } as const;

  const response = await openai.responses.create({
    model: STORYBOARD_MODEL,
    temperature: 0.8,
    response_format: {
      type: 'json_schema',
      json_schema: schema,
    },
    input: [
      {
        role: 'system',
        content:
          'You are The Director, an AI filmmaker planning visually cohesive music video scenes. Respond with detailed but concise visual prompts.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Song prompt: ${projectPrompt}`,
              stylePreset ? `Style preset: ${stylePreset}` : '',
              energy ? `Energy: ${energy}` : '',
              'Scene timing data:',
              JSON.stringify(scenesData),
              'Return a JSON object with vivid visualPrompt, a short title, optional cameraStyle, and motionCue for each scene in order.',
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
    throw new Error('OpenAI response was empty.');
  }

  const parsed = JSON.parse(output) as StoryboardResponse;
  return parsed;
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
    } catch (error) {
      await db
        .update(projects)
        .set({ status: 'ERROR', error: (error as Error).message })
        .where(eq(projects.id, projectId));
      throw error;
    }
  },
);

export const inngestFunctions: InngestFunction[] = [planScenesFunction];
