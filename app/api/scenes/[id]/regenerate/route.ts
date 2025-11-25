import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, projects, scenes } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const scene = await db.query.scenes.findFirst({
    where: eq(scenes.id, id),
  });

  if (!scene) {
    return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
  }

  await db
    .update(projects)
    .set({ status: 'GENERATING_IMAGES' })
    .where(eq(projects.id, scene.projectId));

  await db
    .update(scenes)
    .set({
      status: 'PLANNED',
      imageKeyframeUrl: null,
      videoClipUrl: null,
    })
    .where(eq(scenes.id, scene.id));

  await inngest.send({
    name: 'scene/regenerate',
    data: { sceneId: scene.id },
  });

  return NextResponse.json({ ok: true });
}
