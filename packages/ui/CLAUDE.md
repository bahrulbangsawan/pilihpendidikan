# packages/ui — Shared Component Library (@rulisme/ui)

Reusable React 19 UI primitives published as `@rulisme/ui`, consumed by `apps/cv`, `apps/invoice` and `apps/portfolio`. They are skinned to the Warp design system (`DESIGN.md`) through the shadcn CSS variables each app maps in its `src/styles.css`.

## Build (important)

- Built with **Vite library mode** (`vite.config.ts`, every `src/**/*.{ts,tsx}` file is an entry, ESM, unminified) plus `tsc --declaration --emitDeclarationOnly` for `.d.ts` → `dist/`.
- `exports` maps `./*` → `./dist/*.js` (types `./dist/*.d.ts`) and `./styles/shadcn.css` → `src/styles/shadcn.css`, so **consumers import the built output at runtime**. Build before (or while) developing an app:
  - `bun run build` (one-off) or `bun run dev` (build, then Vite + tsc in watch mode). The root `bun dev`, `bun run dev:<app>` and `bun run build` do this for you through Turborepo.
  - A stale or missing `dist/` shows up as stale/unresolved components in the apps. TypeScript in the apps maps `@rulisme/ui/*` to `src/*`, so `tsc` passes even when `dist/` is stale.
- Every bare import is `external` (not bundled); the apps provide the peer deps (`react`, `@base-ui/react`, `@dnd-kit/*`, `lucide-react`, `radix-ui`, `react-phone-number-input`, `react-day-picker`, `tailwind-merge`, `clsx`, `class-variance-authority`).

## Structure & imports

- `src/ui/` — primitives (button, card, dialog, select, tabs, calendar, …) → `@rulisme/ui/ui/button`
- `src/form/` — composed form pieces (`form-field`, `month-picker`, `section-list`) → `@rulisme/ui/form/form-field`
- `src/reui/phone-input.tsx` → `@rulisme/ui/reui/phone-input`
- `src/lib/utils.ts` (`cn()` helper, phone/URL formatting) → `@rulisme/ui/lib/utils`. `cn()` registers the 9 Warp font-size tokens with tailwind-merge; `bun run parity:twmerge` keeps that list in sync with the apps' `@theme` (see `TYPOGRAPHY.md`).
- `src/lib/image-fade.ts`, `src/lib/use-first-paint-entrance.ts` — motion helpers for the utilities in `@pilihpendidikan/config/motion.css`
- `src/styles/shadcn.css` → `@rulisme/ui/styles/shadcn.css` (imported by each app's `styles.css`)

## Conventions

- Named exports, PascalCase components, function components, React 19 ref-as-prop. `data-slot` on primitive roots (shadcn pattern).
- Add a component under the right `src/` subdir; the glob entry picks it up automatically — no barrel/index file. Rebuild so the new `dist/*.js` export resolves.
- Typography follows `TYPOGRAPHY.md`: Warp tokens only (`text-xs` for chrome, `text-body-sm` for titles), weights 400/500. The root typography lint covers `src/`.

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
