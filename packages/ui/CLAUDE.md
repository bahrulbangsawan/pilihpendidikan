# packages/ui — Shared Component Library (@rulisme/ui)

Reusable React 19 UI primitives published as `@rulisme/ui`, consumed by `apps/cv-bahrul` and `apps/invoice-bahrul`. Note the scope is `@rulisme`, not `@bahrul`.

> This is a **separate** component set from the `apps/web` ↔ `apps/mcp-ui` design system. Those two share their own in-app `components/ui` + typography tokens (enforced by the repo parity scripts); `@rulisme/ui` serves only the cv/invoice apps.

## Build (important)

- Built with **tsup** (`tsup.config.ts`): ESM + `.d.ts`, entry `src/**/*.{ts,tsx}` → `dist/`.
- `exports` maps `./*` → `./dist/*.js`, so **consumers import the built output, not source**. Build before (or while) developing cv/invoice:
  - `bun run build` (one-off) or `bun run dev` (`tsup --watch`) in `packages/ui`.
  - A stale or missing `dist/` shows up as stale/unresolved components in the consumer apps.
- Peer deps (`react`, `@base-ui/react`, `@dnd-kit/*`, `lucide-react`, `radix-ui`, `react-phone-number-input`, `react-day-picker`, `tailwind-merge`, `clsx`, `class-variance-authority`, `zustand`, `remark-gfm`) are `external` — not bundled; the consumer provides them.

## Structure & imports

- `src/ui/` — primitives (button, card, dialog, select, tabs, calendar, …) → `@rulisme/ui/ui/button`
- `src/form/` — composed form pieces (`form-field`, `month-picker`, `section-list`) → `@rulisme/ui/form/form-field`
- `src/reui/phone-input.tsx` → `@rulisme/ui/reui/phone-input`
- `src/lib/utils.ts` (`cn()` helper) → `@rulisme/ui/lib/utils`

## Conventions

- Named exports, PascalCase components, function components, React 19 ref-as-prop. `data-slot` on primitive roots (shadcn pattern).
- Add a component under the right `src/` subdir; the glob entry picks it up automatically — no barrel/index file. Rebuild so the new `dist/*.js` export resolves.

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
