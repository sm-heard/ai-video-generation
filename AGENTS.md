# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and layouts (e.g. `app/page.tsx`, `app/api/**`).
- `lib/`: Shared utilities (e.g. storage, Inngest client, DB access, Remotion helpers).
- `db/`: Drizzle config and schema (e.g. `db/schema.ts`, `drizzle.config.ts`).
- `remotion/`: Remotion compositions for the music video timeline.
- `public/`: Static assets served by Next.js.
- Root config: `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`.

## Build, Test, and Development Commands
- `npm run dev` – Start the local Next.js dev server with Turbopack.
- `npm run build` – Build the production bundle.
- `npm start` – Run the built app in production mode.
- `npm run lint` – Run ESLint on the codebase.

## Coding Style & Naming Conventions
- Language: TypeScript for all application code; use `.tsx` for React components.
- Style: Follow the default Next.js + ESLint config; 2‑space indentation, no semicolon changes unless linted.
- React components: Use PascalCase for components (`MusicVideoPreview.tsx`) and camelCase for functions/variables.
- Folders: Group domain logic by feature when possible (e.g. `app/projects/[id]/`).

## Testing Guidelines
- This MVP does not yet define a formal test suite. Prefer small, pure helpers in `lib/` that can be easily unit tested later.
- When adding tests, mirror the file path (e.g. `lib/foo.ts` → `lib/__tests__/foo.test.ts`).

## Commit & Pull Request Guidelines
- Commits: Use clear, present‑tense messages (e.g. `add project schema for scenes`, `wire up inngest planning flow`).
- Pull Requests: Include a short summary, implementation notes, and screenshots or video for UI changes.
- Keep changes focused; avoid mixing refactors with feature work unless necessary for the change. 

## Security & Configuration Tips
- Never commit secrets; use `.env.local` for local development and Vercel project settings in production.
- Be careful logging external model responses; avoid leaking prompts or credentials in logs. 

