'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';

const STATUS_STEPS = [
  { id: 'CREATED', label: 'Created' },
  { id: 'PLANNING', label: 'Planning scenes' },
  { id: 'GENERATING_IMAGES', label: 'Generating images' },
  { id: 'GENERATING_VIDEO', label: 'Animating clips' },
  { id: 'FINALIZING', label: 'Finalizing preview' },
  { id: 'COMPLETED', label: 'Completed' },
] as const;

type ProjectStatus = (typeof STATUS_STEPS)[number]['id'] | 'ERROR';

interface Scene {
  id: string;
  order: number;
  section: string;
  status: string;
  visualPrompt: string;
  imageKeyframeUrl: string | null;
  videoClipUrl: string | null;
}

interface ApiProjectResponse {
  project: {
    id: string;
    prompt: string;
    stylePreset: string | null;
    energy: string | null;
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
  const [project, setProject] = useState<ApiProjectResponse['project'] | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
            Updated {new Date(project.createdAt).toLocaleString()}
          </p>
        </div>
      </section>

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
                      'rounded-full px-3 py-1 text-xs uppercase tracking-wide',
                      scene.status.includes('DONE')
                        ? 'bg-emerald-400/20 text-emerald-200'
                        : 'bg-white/10 text-white/70',
                    )}
                  >
                    {scene.status}
                  </span>
                </div>
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900">
                  {scene.imageKeyframeUrl ? (
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
                      Waiting for keyframe…
                    </div>
                  )}
                </div>
                <p className="text-sm text-white/80">{scene.visualPrompt}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
