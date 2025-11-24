import ProjectDetailClient from './project-detail-client';

interface ProjectDetailPageParams {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageParams) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Project overview</p>
          <h1 className="text-4xl font-semibold">Generation progress</h1>
          <p className="text-white/70">
            Watch The Director build your music video step by step. This page auto-refreshes every few seconds and will
            show placeholder media until real assets arrive.
          </p>
        </header>
        <ProjectDetailClient projectId={id} />
      </div>
    </div>
  );
}
