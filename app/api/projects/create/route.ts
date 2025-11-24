import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db, projects, type EnergyLevel, type StylePreset } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';

const MAX_DURATION_SECONDS = 60;
const createProjectSchema = z.object({
  audioUrl: z.string().url(),
  prompt: z.string().min(5).max(2000),
  stylePreset: z.enum(['dreamy_pastel', 'graffiti_energy', 'minimalist_cinematic']).optional(),
  energy: z.enum(['low', 'medium', 'high']).optional(),
  duration: z.number().min(1).max(MAX_DURATION_SECONDS),
  tempo: z.number().positive().max(400),
  beats: z.array(z.number().nonnegative()).min(1),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);

  const result = createProjectSchema.safeParse(payload);

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid payload', issues: result.error.flatten() },
      { status: 400 },
    );
  }

  const { audioUrl, prompt, energy, stylePreset, duration, beats, tempo } =
    result.data;

  try {
    const trimmedBeats = beats
      .filter((beat) => beat <= duration)
      .map((beat) => Number(beat.toFixed(3)));

    const [project] = await db
      .insert(projects)
      .values({
        audioUrl,
        prompt,
        stylePreset: (stylePreset ?? 'dreamy_pastel') as StylePreset,
        energy: (energy ?? 'medium') as EnergyLevel,
        duration: Math.round(duration),
        status: 'CREATED',
        beatsSummary: {
          tempo,
          beatCount: trimmedBeats.length,
          preview: trimmedBeats.slice(0, 64),
        },
      })
      .returning();

    await inngest.send({
      name: 'project/created',
      data: {
        projectId: project.id,
        duration: project.duration,
        tempo,
        beats: trimmedBeats,
      },
    });

    return NextResponse.json({ projectId: project.id });
  } catch (error) {
    console.error('[project-create]', error);
    return NextResponse.json(
      { error: 'Unable to create project. Please try again.' },
      { status: 500 },
    );
  }
}
