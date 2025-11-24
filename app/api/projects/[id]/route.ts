import 'server-only';

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db, projects } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const projectId = params.id;

  if (!projectId) {
    return NextResponse.json(
      { error: 'Missing project id parameter' },
      { status: 400 },
    );
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: {
      scenes: {
        orderBy: (scene, { asc: orderAsc }) => orderAsc(scene.order),
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json({
    project: {
      ...project,
      scenes: project.scenes ?? [],
    },
  });
}
