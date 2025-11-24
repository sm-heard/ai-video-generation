import {
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const projectStatusEnum = pgEnum('project_status', [
  'CREATED',
  'PLANNING',
  'GENERATING_IMAGES',
  'GENERATING_VIDEO',
  'FINALIZING',
  'COMPLETED',
  'ERROR',
]);

export const sceneStatusEnum = pgEnum('scene_status', [
  'PENDING',
  'PLANNED',
  'IMAGE_PENDING',
  'IMAGE_DONE',
  'VIDEO_PENDING',
  'VIDEO_DONE',
  'COMPLETED',
  'ERROR',
]);

export const sceneSectionEnum = pgEnum('scene_section', [
  'INTRO',
  'VERSE',
  'CHORUS',
  'BRIDGE',
  'OUTRO',
  'OTHER',
]);

export const energyEnum = pgEnum('energy_level', ['low', 'medium', 'high']);

export const stylePresetEnum = pgEnum('style_preset', [
  'dreamy_pastel',
  'graffiti_energy',
  'minimalist_cinematic',
]);
export const imageModelEnum = pgEnum('image_model', [
  'nano_banana',
  'imagen_fast',
]);
export const videoModelEnum = pgEnum('video_model', [
  'seedance_fast',
  'kling_turbo',
]);

export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type SceneStatus = (typeof sceneStatusEnum.enumValues)[number];
export type SceneSection = (typeof sceneSectionEnum.enumValues)[number];
export type EnergyLevel = (typeof energyEnum.enumValues)[number];
export type StylePreset = (typeof stylePresetEnum.enumValues)[number];
export type ImageModel = (typeof imageModelEnum.enumValues)[number];
export type VideoModel = (typeof videoModelEnum.enumValues)[number];

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  audioUrl: text('audio_url').notNull(),
  prompt: text('prompt').notNull(),
  stylePreset: stylePresetEnum('style_preset').default('dreamy_pastel'),
  energy: energyEnum('energy').default('medium'),
  duration: integer('duration').notNull(), // seconds (capped at 60 for MVP)
  status: projectStatusEnum('status').default('CREATED').notNull(),
  beatsSummary: jsonb('beats_summary'),
  imageModel: imageModelEnum('image_model').default('nano_banana'),
  videoModel: videoModelEnum('video_model').default('seedance_fast'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const scenes = pgTable('scenes', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  order: integer('order_index').notNull(),
  startTime: doublePrecision('start_time').notNull(),
  duration: doublePrecision('duration').notNull(),
  startBeatIndex: integer('start_beat_index').notNull(),
  endBeatIndex: integer('end_beat_index').notNull(),
  section: sceneSectionEnum('section').default('OTHER').notNull(),
  visualPrompt: text('visual_prompt').notNull(),
  imageKeyframeUrl: text('image_keyframe_url'),
  videoClipUrl: text('video_clip_url'),
  status: sceneStatusEnum('status').default('PENDING').notNull(),
  provider: text('provider'),
  predictionId: text('prediction_id'),
  metadata: jsonb('metadata'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  scenes: many(scenes),
}));

export const scenesRelations = relations(scenes, ({ one }) => ({
  project: one(projects, {
    fields: [scenes.projectId],
    references: [projects.id],
  }),
}));
