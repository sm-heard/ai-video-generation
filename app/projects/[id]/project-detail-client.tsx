'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import { Player, type PlayerRef } from '@remotion/player';

import { cn } from '@/lib/utils';
import { MusicVideo, type SceneClip } from '@/remotion/MusicVideo';

const STATUS_STEPS = [
  { id: 'CREATED', label: 'Created', description: 'Waiting to start planner' },
  {
    id: 'PLANNING',
    label: 'Planning scenes',
    description: 'Grouping beats + writing storyboard',
  },
  {
    id: 'GENERATING_IMAGES',
    label: 'Generating images',
    description: 'Calling the image model for each scene',
  },
  {
    id: 'GENERATING_VIDEO',
    label: 'Animating clips',
    description: 'Converting keyframes to motion clips',
  },
  {
    id: 'FINALIZING',
    label: 'Finalizing preview',
    description: 'Syncing everything in Remotion',
  },
  { id: 'COMPLETED', label: 'Completed', description: 'Ready to export' },
] as const;

type ProjectStatus = (typeof STATUS_STEPS)[number]['id'] | 'ERROR';

interface Scene {
  id: string;
  order: number;
  startTime: number;
  duration: number;
  section: string;
  status: string;
  visualPrompt: string;
  imageKeyframeUrl: string | null;
  videoClipUrl: string | null;
}

interface ApiProjectResponse {
  project: {
    id: string;
    audioUrl: string;
    prompt: string;
    stylePreset: string | null;
    energy: string | null;
    imageModel: string | null;
    videoModel: string | null;
    duration: number;
    status: ProjectStatus;
    beatsSummary: {
      tempo?: number;
      beatCount?: number;
    } | null;
    createdAt: string;
    scenes: Scene[];
  };
}

interface ProjectDetailClientProps {
  projectId: string;
}

function getStatusIndex(status: ProjectStatus) {
  const idx = STATUS_STEPS.findIndex((step) => step.id === status);
  if (idx === -1) {
    return status === 'ERROR' ? STATUS_STEPS.length - 1 : 0;
  }
  return idx;
}

export default function ProjectDetailClient({
  projectId,
}: ProjectDetailClientProps) {
  const [project, setProject] =
    useState<ApiProjectResponse['project'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(
    null,
  );

  const playerRef = useRef<PlayerRef>(null);
  const exportAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let isActive = true;

    async function fetchProject() {
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Project not found');
        }
        const data: ApiProjectResponse = await response.json();
        if (isActive) {
          setProject(data.project);
          setErrorMessage(null);
        }
      } catch (error) {
        console.error('project-detail', error);
        if (isActive) {
          setErrorMessage('Unable to load project details.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    fetchProject();
    const intervalId = setInterval(fetchProject, 5000);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [projectId]);

  const currentStepIndex = useMemo(() => {
    if (!project) {
      return 0;
    }
    return getStatusIndex(project.status);
  }, [project]);

  const remotionScenes = useMemo<SceneClip[]>(() => {
    if (!project) {
      return [];
    }
    return project.scenes.map((scene) => ({
      id: scene.id,
      order: scene.order,
      startTime:
        typeof scene.startTime === 'number'
          ? scene.startTime
          : Number(scene.startTime ?? scene.order * 4),
      duration:
        typeof scene.duration === 'number'
          ? Math.max(scene.duration, 0.5)
          : 4,
      imageKeyframeUrl: scene.imageKeyframeUrl,
      videoClipUrl: scene.videoClipUrl,
      visualPrompt: scene.visualPrompt,
    }));
  }, [project]);

  const sceneStats = useMemo(() => {
    const total = project?.scenes.length ?? 0;
    const imagesDone =
      project?.scenes.filter((scene) =>
        ['IMAGE_DONE', 'VIDEO_PENDING', 'VIDEO_DONE'].includes(scene.status),
      ).length ?? 0;
    const videosDone =
      project?.scenes.filter((scene) => scene.status === 'VIDEO_DONE').length ??
      0;
    return { total, imagesDone, videosDone };
  }, [project]);

  const fps = 30;
  const durationInFrames = Math.max(
    1,
    Math.round((project?.duration ?? 1) * fps),
  );

  useEffect(() => {
    return () => {
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl);
      }
    };
  }, [exportUrl]);

  const handleExport = useCallback(async () => {
    if (!project) {
      return;
    }
    setExportError(null);
    setIsExporting(true);
    setExportUrl(null);

    try {
      const container = document.getElementById('project-preview-canvas');
      const canvas = container?.querySelector('canvas') as
        | (HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream })
        | undefined;
      if (!canvas || typeof canvas.captureStream !== 'function') {
        throw new Error('Unable to capture video stream from preview.');
      }
      const canvasStream = canvas.captureStream(fps);
      if (!exportAudioRef.current) {
        exportAudioRef.current =
          typeof window !== 'undefined' ? new Audio(project.audioUrl) : null;
        if (exportAudioRef.current) {
          exportAudioRef.current.crossOrigin = 'anonymous';
        }
      }
      const exportAudio = exportAudioRef.current;

      const audioStream =
        exportAudio && 'captureStream' in exportAudio
          ? exportAudio.captureStream()
          : null;

      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(audioStream ? audioStream.getAudioTracks() : []),
      ]);

      if (combinedStream.getTracks().length === 0) {
        throw new Error('No media tracks available for export.');
      }

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
      });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      playerRef.current?.pause();
      playerRef.current?.seekTo(0);

      recorder.start();
      playerRef.current?.play();
      if (exportAudio) {
        await exportAudio.play().catch(() => null);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, project.duration * 1000 + 750),
      );

      recorder.stop();
      await stopped;
      playerRef.current?.pause();
      exportAudio?.pause();

      const blob = new Blob(chunks, { type: 'video/webm' });
      const objectUrl = URL.createObjectURL(blob);
      setExportUrl(objectUrl);
    } catch (err) {
      console.error('export-video', err);
      setExportError(
        err instanceof Error
          ? err.message
          : 'Failed to export video. Please try again.',
      );
    } finally {
      setIsExporting(false);
    }
  }, [fps, project]);

  const handleRegenerateScene = useCallback(async (sceneId: string) => {
    setRegeneratingSceneId(sceneId);
    try {
      const response = await fetch(`/api/scenes/${sceneId}/regenerate`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to trigger regeneration');
      }
    } catch (error) {
      console.error('scene-regenerate', error);
      setErrorMessage('Unable to regenerate scene. Please try again later.');
    } finally {
      setRegeneratingSceneId(null);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
        Loading project details…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-200">
        {errorMessage || 'Project not found.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
          <AlertCircle className="h-4 w-4" />
          {errorMessage}
        </div>
      )}

      <section className="grid gap-6 rounded-2xl border border-white/10 bg-white/5 p-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-white/60">Prompt</p>
            <p className="text-lg font-medium">{project.prompt}</p>
          </div>
            <div className="flex flex-wrap gap-4 text-sm text-white/70">
              <span className="rounded-full border border-white/20 px-3 py-1">
                Style: {project.stylePreset}
              </span>
              <span className="rounded-full border border-white/20 px-3 py-1">
                Energy: {project.energy}
              </span>
              <span className="rounded-full border border-white/20 px-3 py-1">
                Image model: {project.imageModel}
              </span>
              <span className="rounded-full border border-white/20 px-3 py-1">
                Video model: {project.videoModel}
              </span>
              <span className="rounded-full border border-white/20 px-3 py-1">
                Duration: {project.duration}s
              </span>
            {project.beatsSummary?.tempo && (
              <span className="rounded-full border border-white/20 px-3 py-1">
                Tempo: {project.beatsSummary.tempo} BPM
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 p-4">
          <p className="text-sm uppercase tracking-wide text-white/60">
            Pipeline status
          </p>
          <p className="text-2xl font-semibold">
            {project.status === 'ERROR' ? 'Error' : STATUS_STEPS[currentStepIndex].label}
          </p>
          <p className="text-sm text-white/60">
            {STATUS_STEPS[currentStepIndex]?.description}
          </p>
        </div>
      </section>

      {project.scenes.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-white/60">
                Live preview
              </p>
              <p className="text-xs text-white/50">
                Hit play to watch and hear the exact track you uploaded.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
              <span>Powered by Remotion · {fps} FPS</span>
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 px-4 py-1 text-sm font-medium text-emerald-100 transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {isExporting ? 'Exporting…' : 'Export MP4'}
              </button>
            </div>
          </div>
          <div id="project-preview-canvas" className="rounded-2xl border border-transparent">
          <Player
            component={MusicVideo}
            inputProps={{
              scenes: remotionScenes,
              audioUrl: project.audioUrl,
              fps,
            }}
            durationInFrames={durationInFrames}
            compositionWidth={1280}
            compositionHeight={720}
            fps={fps}
            controls
            loop
            muted={false}
            ref={playerRef}
            style={{
              width: '100%',
              borderRadius: '1rem',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
          </div>
          <audio
            ref={audioRef}
            src={project.audioUrl}
            preload="auto"
            className="hidden"
          />
          {exportError && (
            <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {exportError}
            </p>
          )}
          {exportUrl && (
            <a
              href={exportUrl}
              download={`music-video-${project.id}.webm`}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:border-white/60"
            >
              <Download className="h-4 w-4" />
              Download exported video
            </a>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="mb-4 text-sm uppercase tracking-wide text-white/60">
          Workflow progress
        </p>
        <ol className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          {STATUS_STEPS.map((step, index) => {
            const isCompleted = index < currentStepIndex;
            const isActive = index === currentStepIndex;

            return (
              <li
                key={step.id}
                className={cn(
                  'flex flex-1 items-center gap-3 rounded-xl border px-3 py-2 transition',
                  isCompleted
                    ? 'border-emerald-400/50 bg-emerald-400/10'
                    : isActive
                      ? 'border-white/60 bg-white/10'
                      : 'border-white/10 bg-black/20',
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                ) : isActive ? (
                  <Clock className="h-5 w-5 text-white" />
                ) : (
                  <Clock className="h-5 w-5 text-white/40" />
                )}
                <span className="text-sm font-medium">{step.label}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white/80">
            <p className="text-xs uppercase tracking-wide text-white/50">
              Scenes planned
            </p>
            <p className="text-2xl font-semibold">{sceneStats.total}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white/80">
            <p className="text-xs uppercase tracking-wide text-white/50">
              Keyframes ready
            </p>
            <p className="text-2xl font-semibold">
              {sceneStats.imagesDone}/{sceneStats.total}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white/80">
            <p className="text-xs uppercase tracking-wide text-white/50">
              Clips animated
            </p>
            <p className="text-2xl font-semibold">
              {sceneStats.videosDone}/{sceneStats.total}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm uppercase tracking-wide text-white/60">
            Scenes storyboard
          </p>
          <p className="text-sm text-white/60">
            {project.scenes.length > 0
              ? `${project.scenes.length} scenes`
              : 'Scenes will appear here after planning.'}
          </p>
        </div>
        {project.scenes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 bg-black/30 p-8 text-center text-white/60">
            Storyboard not generated yet. Once the planner runs, scene cards will populate with prompts and media.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {project.scenes.map((scene) => (
              <div
                key={scene.id}
                className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4"
              >
                <div className="flex items-center justify-between text-sm text-white/70">
                  <span>
                    Scene {scene.order + 1} · {scene.section}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs uppercase tracking-wide',
                      scene.status === 'VIDEO_DONE'
                        ? 'bg-emerald-400/20 text-emerald-200'
                        : scene.status === 'ERROR'
                          ? 'bg-red-500/30 text-red-200'
                          : 'bg-white/10 text-white/70',
                    )}
                  >
                    {scene.status === 'VIDEO_DONE' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : scene.status.includes('PENDING') ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : scene.status.includes('IMAGE') ? (
                      <ImageIcon className="h-3.5 w-3.5" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    {scene.status}
                  </span>
                </div>
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900">
                  {scene.videoClipUrl ? (
                    <video
                      src={scene.videoClipUrl}
                      controls
                      className="h-full w-full object-cover"
                      poster={scene.imageKeyframeUrl ?? undefined}
                    />
                  ) : scene.imageKeyframeUrl ? (
                    <Image
                      src={scene.imageKeyframeUrl}
                      alt={`Scene ${scene.order + 1}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 50vw"
                      priority={scene.order < 2}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
                      Waiting for media…
                    </div>
                  )}
                </div>
                <p className="text-sm text-white/80">{scene.visualPrompt}</p>
                <button
                  type="button"
                  onClick={() => handleRegenerateScene(scene.id)}
                  disabled={
                    regeneratingSceneId === scene.id ||
                    scene.status.includes('PENDING') ||
                    project.status === 'PLANNING'
                  }
                  className="text-xs uppercase tracking-wide text-white/70 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-white/30"
                >
                  {regeneratingSceneId === scene.id
                    ? 'Regenerating…'
                    : 'Regenerate scene'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
