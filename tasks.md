# **AI Video Generation App ("The Director") – Implementation Plan**

Objective: Build an MVP end‑to‑end AI music video generation pipeline for the hackathon.  
MVP Category: Music Video Pipeline.  
Stack: Next.js (App Router), Inngest (Workflow Engine), Vercel AI SDK, Drizzle, Neon, Vercel Blob, Remotion, Mediabunny.

Assumptions:
- Single‑user demo (no auth/multi‑tenant needed).
- User uploads their own audio (no music generation for MVP).
- Hard cap of ~60s of audio for the MVP path.
- All heavy rendering/export happens client‑side via Mediabunny.

---

## **Phase 0: Foundation & Architecture (Hours 0–4)**

*Goal: Set up storage, database schema, and workflow skeleton with clear statuses.*

- [ ] **Repository & Config**
  - [ ] Confirm Next.js App Router scaffold and basic app shell.
  - [ ] Add `.env.local` with required secrets (Neon, Vercel Blob, model APIs, Inngest).

- [ ] **Storage Setup (Vercel Blob)**
  - [ ] Configure `BLOB_READ_WRITE_TOKEN` and any required Blob bucket config.
  - [ ] Create `lib/storage.ts` with helpers:
    - [ ] `uploadAudio(file: File | Blob): Promise<{ url: string }>`
    - [ ] `uploadImage(buffer: Buffer | Blob): Promise<{ url: string }>`
    - [ ] `uploadVideo(buffer: Buffer | Blob): Promise<{ url: string }>`

- [ ] **Database (Neon + Drizzle)**
  - [ ] Create `drizzle.config.ts`.
  - [ ] Create `db/schema.ts` with:
    - [ ] **`projects` table** (single user, but future‑proof):
      - `id` (PK)
      - `audioUrl` (string)
      - `prompt` (text)
      - `stylePreset` (text/enum, e.g. "dreamy_pastel", "graffiti_energy", etc.)
      - `energy` (text/enum: "low" | "medium" | "high")
      - `duration` (number, seconds – capped at 60 for MVP path)
      - `status` (enum):
        - `"CREATED"`, `"PLANNING"`, `"GENERATING_IMAGES"`, `"GENERATING_VIDEO"`, `"FINALIZING"`, `"COMPLETED"`, `"ERROR"`
      - `beatsSummary` (JSON – optional summary of beats/tempo)
      - `error` (text, nullable)
      - `createdAt` (timestamp)
    - [ ] **`scenes` table**:
      - `id` (PK)
      - `projectId` (FK → `projects.id`)
      - `order` (int – scene index)
      - `startTime` (number, seconds from start of audio)
      - `duration` (number, seconds)
      - `startBeatIndex` (int)
      - `endBeatIndex` (int)
      - `section` (enum: `"INTRO"`, `"VERSE"`, `"CHORUS"`, `"BRIDGE"`, `"OUTRO"`, `"OTHER"`)
      - `visualPrompt` (text – what we send to image/video models)
      - `imageKeyframeUrl` (string, nullable)
      - `videoClipUrl` (string, nullable)
      - `status` (enum):
        - `"PENDING"`, `"PLANNED"`, `"IMAGE_PENDING"`, `"IMAGE_DONE"`, `"VIDEO_PENDING"`, `"VIDEO_DONE"`, `"COMPLETED"`, `"ERROR"`
      - `provider` (text, e.g. `"nano_banana"`, `"kling"`)
      - `predictionId` (text, nullable – for video jobs)
      - `metadata` (JSON, nullable – raw provider payloads)
      - `error` (text, nullable)
  - [ ] Run `npx drizzle-kit push` to apply schema.

- [ ] **Workflow Engine (Inngest)**
  - [ ] `npm install inngest`.
  - [ ] Create `lib/inngest/client.ts`:
    - [ ] Configure Inngest client with app name.
  - [ ] Create API entrypoint `app/api/inngest/route.ts`:
    - [ ] Wire Inngest HTTP handler.
    - [ ] Export all functions (planning, images, video, regeneration).

---

## **Phase 1: Input, Upload & Audio Analysis (Hours 4–12)**

*Goal: Let the user upload audio + creative direction, analyze beats client‑side, and create a `project`.*

- [ ] **Frontend: Upload & Prompt Interface**
  - [ ] Create a client page (e.g. `/`) with:
    - [ ] File dropzone / picker for `.mp3` / `.wav`.
    - [ ] Required free‑text `prompt` input.
    - [ ] Optional `stylePreset` select with a few curated options:
      - e.g. `"Dreamy pastel nature"`, `"High‑energy graffiti city"`, `"Minimalist cinematic"`.
    - [ ] Optional `energy` control (select or slider: low/medium/high).
  - [ ] Disable submit until:
    - [ ] Audio file selected.
    - [ ] Prompt entered.

- [ ] **Client‑Side Audio Processing**
  - [ ] Integrate **Mediabunny** (client‑side) to:
    - [ ] Load the audio.
    - [ ] Compute exact duration (seconds).
  - [ ] Enforce **60s cap**:
    - [ ] If `duration > 60s`, show UI message:
      - [ ] "MVP supports up to 60 seconds. Trim to first 60s?"
    - [ ] On confirm, keep beats/timing only for the first 60s.
  - [ ] Integrate **web-audio-beat-detector** to:
    - [ ] Compute `beats[]` (timestamps) and tempo.
    - [ ] Optionally compute a small `beatsSummary` (tempo, beat count, etc.) for DB.

- [ ] **Upload to Vercel Blob**
  - [ ] Immediately upload audio file to Blob:
    - [ ] Use `lib/storage.uploadAudio`.
    - [ ] Handle errors and show retry UI.

- [ ] **Project Creation API**
  - [ ] Create `POST /api/projects/create`:
    - [ ] Body: `{ audioUrl, prompt, stylePreset?, energy?, duration, beats }`.
    - [ ] Insert row into `projects`:
      - [ ] Set `status = "CREATED"`.
      - [ ] Store `beatsSummary` (optional).
    - [ ] Respond with `{ projectId }`.
  - [ ] **Trigger Workflow (Planning Event)**:
    - [ ] After DB insert, call `inngest.send`:
      - [ ] Event name: e.g. `"project/created"`.
      - [ ] Data: `{ projectId, beats, duration }`.

---

## **Phase 2: The Director (Planning & Sync) (Hours 12–18)**

*Goal: Convert the user's vibe + beats into a structured storyboard with scenes in the DB.*

- [ ] **Inngest Function: Planning**
  - [ ] In `lib/inngest/functions.ts`, define function for `"project/created"`:
    - [ ] `step.run('generate-storyboard', async (step) => { ... })`.
  - [ ] **Scene Grouping Logic**:
    - [ ] Group `beats[]` into scenes of ~3–6 seconds:
      - [ ] Maintain `startBeatIndex`, `endBeatIndex`, `startTime`, `duration`.
      - [ ] Target ~12–16 scenes for a 60s track.
    - [ ] Assign a **section label** per scene based on position:
      - [ ] Early scenes → `"INTRO"`.
      - [ ] Middle scenes → `"VERSE"` / `"CHORUS"` (alternate).
      - [ ] Final scenes → `"OUTRO"`.
  - [ ] **LLM Storyboard (OpenAI via Vercel AI SDK or official client)**
    - [ ] Call **OpenAI GPT-5.1** (latest available structured-output model) using `generateObject` or the OpenAI responses API:
      - [ ] Inputs: `prompt`, `stylePreset`, `energy`, sections, and beat timing.
      - [ ] Output: array of scene descriptors with:
        - [ ] `visualPrompt`, optional style notes, motion suggestions.
    - [ ] Map responses to `scenes` rows:
      - [ ] `order`, `startTime`, `duration`, `startBeatIndex`, `endBeatIndex`, `section`, `visualPrompt`.
  - [ ] **Persistence & Status**
    - [ ] Before planning: update `projects.status = "PLANNING"`.
    - [ ] Bulk insert `scenes` with `status = "PLANNED"`.
    - [ ] On success: update `projects.status = "GENERATING_IMAGES"` (ready for next phase).
    - [ ] On failure: set `projects.status = "ERROR"` and store error message.

---

## **Phase 2.5: Vertical Slice (Placeholder Assets) (Hours 18–22)**

*Goal: Prove the end‑to‑end path (upload → beats → scenes → preview) using fake/placeholder visuals before integrating real models.*

- [ ] **Placeholder Asset Generation**
  - [ ] After scenes are created, temporarily:
    - [ ] Set `imageKeyframeUrl` to stock/placeholder images (e.g., static URLs or generated gradients) for each scene.
    - [ ] Optionally set `videoClipUrl` to a short stock loop or colored bar test video.
  - [ ] Mark `scenes.status` accordingly:
    - [ ] `"IMAGE_DONE"` and/or `"VIDEO_DONE"` for placeholder content.

- [ ] **Basic Project Detail API**
  - [ ] Create `GET /api/projects/:id`:
    - [ ] Returns project and its scenes with all timing/status fields.

- [ ] **Remotion Composition (First Pass)**
  - [ ] Create `remotion/MusicVideo.tsx`:
    - [ ] Read scenes (passed in as props or via context).
    - [ ] Place each scene on timeline using `startTime`/`duration` or beat‑derived frames.
    - [ ] Use placeholder `imageKeyframeUrl`/`videoClipUrl`.
    - [ ] Sync transitions to beat times.

- [ ] **Project Detail Page & Progress (First Pass)**
  - [ ] Create `/projects/[id]` page:
    - [ ] Poll `GET /api/projects/:id` every few seconds.
    - [ ] Show high‑level pipeline status based on `projects.status`.
    - [ ] Embed `@remotion/player` using placeholder assets.
  - [ ] Confirm:
    - [ ] Upload → Create project → Scenes → Placeholder preview is working end‑to‑end.

---

## **Phase 3: The Asset Factory (Images & Motion) (Hours 22–36)**

*Goal: Replace placeholders with real generated images and motion, with robust status tracking and retries.*

- [ ] **External API Spikes (Before Full Integration)**
  - [ ] **Nano Banana Pro via Replicate (Images)**
    - [ ] Hardcode a sample prompt and invoke the Replicate Nano Banana model.
    - [ ] Confirm auth, request shape, response structure.
    - [ ] Measure latency and failure modes.
  - [ ] **Kling via Replicate (Image-to-Video)**
    - [ ] Hardcode a sample image and invoke the Replicate Kling model.
    - [ ] Confirm how to get `predictionId` (Replicate prediction ID) and poll status.
    - [ ] Verify output format and size.

- [ ] **Inngest Function: Step 2 – `generate-images`**
  - [ ] In `lib/inngest/functions.ts`, define `step.run('generate-images', ...)`:
    - [ ] Input: `projectId`.
    - [ ] Select scenes where `status IN ("PLANNED", "IMAGE_PENDING")`.
    - [ ] For each scene:
      - [ ] Call Nano Banana Pro via Replicate with `visualPrompt`, `stylePreset`, `energy`, and section.
      - [ ] Upload resulting image to Blob via `uploadImage`.
      - [ ] Update `scenes.imageKeyframeUrl`, `scenes.status = "IMAGE_DONE"`, `provider = "nano_banana"`, `metadata` as needed.
    - [ ] Handle retries (rely on Inngest retry + simple error checks).
  - [ ] Update project status:
    - [ ] Before step: ensure `projects.status >= "GENERATING_IMAGES"`.
    - [ ] After all images done: set `projects.status = "GENERATING_VIDEO"`.

- [ ] **Inngest Function: Step 3 – `trigger-animation`**
  - [ ] Define `step.run('trigger-animation', ...)`:
    - [ ] For each scene with `status IN ("IMAGE_DONE", "VIDEO_PENDING")`:
      - [ ] Call Kling image-to-video via Replicate with `imageKeyframeUrl`.
      - [ ] Store `scenes.predictionId` (Replicate prediction ID), `provider = "kling"` (or `"replicate"`), `status = "VIDEO_PENDING"`.
    - [ ] Return list of `{ sceneId, predictionId }`.

- [ ] **Inngest Function: Step 4 – `wait-for-kling`**
  - [ ] Add `await step.sleep('wait-for-kling', '5m')` (or similar):
    - [ ] Avoid server billing while waiting on Kling.

- [ ] **Inngest Function: Step 5 – `collect-videos`**
  - [ ] Define `step.run('collect-videos', ...)`:
    - [ ] Poll Kling for each `predictionId`.
    - [ ] When ready, download video and `uploadVideo` to Blob.
    - [ ] Update `scenes.videoClipUrl`, `scenes.status = "VIDEO_DONE"`.
  - [ ] After all scenes have `VIDEO_DONE`:
    - [ ] Set `projects.status = "FINALIZING"` (or `"COMPLETED"` if no further processing).

- [ ] **Scene Regeneration Path**
  - [ ] API: `POST /api/scenes/:id/regenerate`
    - [ ] Body: optional overrides (e.g., small prompt tweak for future).
    - [ ] Send Inngest event `"scene/regenerate"` with `{ sceneId }`.
  - [ ] Inngest handler `"scene/regenerate"`:
    - [ ] Reset that scene’s `status` to `"IMAGE_PENDING"` then `"VIDEO_PENDING"`.
    - [ ] Re‑run image + video steps for that single scene.
    - [ ] Update `imageKeyframeUrl`, `videoClipUrl`, `metadata`, `error` as needed.

---

## **Phase 4: The Editor & Preview (Hours 36–48)**

*Goal: Assemble generated clips into a synced music video and support client‑side export.*

- [ ] **Remotion Composition (Finalized)**
  - [ ] Refine `remotion/MusicVideo.tsx` to:
    - [ ] Use real `videoClipUrl` per scene when available, fall back to `imageKeyframeUrl`/placeholder.
    - [ ] Use beats/`startTime`/`duration` to align scene boundaries to beat transitions.
    - [ ] Optionally trim Kling’s ~5s clips to exact beat intervals per scene.

- [ ] **Project Detail Page – Progress & Controls**
  - [ ] On `/projects/[id]` page:
    - [ ] Continue polling `GET /api/projects/:id`.
    - [ ] Map `projects.status` to a clear progress timeline:
      - [ ] Uploading → Planning → Generating Images → Animating → Finalizing → Done.
    - [ ] Show per‑scene status chips using `scenes.status`.
    - [ ] Show thumbnails from `imageKeyframeUrl`.
    - [ ] Add a **“Regenerate”** button for each scene:
      - [ ] Calls `POST /api/scenes/:id/regenerate`.
      - [ ] Disable while scene is in a pending state.

- [ ] **Preview Player Integration**
  - [ ] Embed `@remotion/player` inside the detail page:
    - [ ] Allow play/pause, scrub, and basic navigation.
    - [ ] Ensure it stays in sync with audio for the 60s track.

- [ ] **Client‑Side Export (Mediabunny)**
  - [ ] Integrate Mediabunny on the client to:
    - [ ] Record the `<canvas>` output of the Remotion player.
    - [ ] Mux audio + frames into an MP4 locally on the user’s device.
  - [ ] Add an **“Export MP4”** button:
    - [ ] Shows progress while rendering.
    - [ ] Offers file download when complete.
  - [ ] Validate:
    - [ ] Output is at least 1080p, 30fps where feasible.
    - [ ] Audio and video remain in sync.

---

## **Phase 5: Polish, Reliability & Deployment (Hours 48+)**

*Goal: Harden the MVP for demo/judging: reliability, UX cues, and deployment.*

- [ ] **Error Handling & Observability**
  - [ ] Ensure all Inngest steps set `projects.status = "ERROR"` on unrecoverable errors.
  - [ ] Populate `projects.error` and `scenes.error` with human‑readable messages.
  - [ ] Surface basic error states in the UI (banner on project page).

- [ ] **UX Polish**
  - [ ] Add loading and disabled states on upload and buttons.
  - [ ] Improve empty states (no scenes yet, planning in progress, etc.).
  - [ ] Add a way to list recent projects (even just from a single user).

- [ ] **Performance & Cost Considerations**
  - [ ] Log basic metrics per project:
    - [ ] Number of scenes, number of image/video generations.
    - [ ] Approximate cost per scene (rough constants per API call).
  - [ ] Add simple caching where reasonable (e.g., do not re‑call models when regenerating without changes).

- [ ] **Deployment**
  - [ ] Deploy Next.js app to Vercel.
  - [ ] Connect Inngest via Vercel Integration.
  - [ ] Configure all environment variables in Vercel dashboard.
  - [ ] Generate at least **two** sample videos end‑to‑end as demo artifacts.
