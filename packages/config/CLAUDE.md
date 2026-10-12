# packages/config — Shared TypeScript Base (@pilihpendidikan/config)

The workspace's shared config. Provides `tsconfig.base.json` and `motion.css`; no source code, no build step.

## `motion.css` — shared motion primitives

Every UI app (`apps/home`, `apps/cv`, `apps/invoice`, `apps/portfolio`, `apps/design`) imports it right after `tailwindcss`:

```css
@import "@pilihpendidikan/config/motion.css";
```

It implements DESIGN.md § Motion: the curve and duration every bare `transition-*` uses (150ms, `cubic-bezier(0.4, 0, 0.2, 1)`, also as `ease-standard`), the `press` utility (`translateY(1px) scale(0.99)` on `:active`, instant), the `pulse-dot` status pulse (only without reduced motion), the Blocks spinner (`.spinner-blocks`) and the single `prefers-reduced-motion` kill switch. Zedative has no entrances, hover lifts, route transitions or overlay animations, so there are no utilities for them. Change a value here, never per component.

## Usage

The root `tsconfig.json` (for `scripts/`) extends it by package name; `packages/ui` extends it by relative path (`../config/tsconfig.base.json`):

```jsonc
{ "extends": "@pilihpendidikan/config/tsconfig.base.json" }
```

The apps keep self-contained `tsconfig.json` files (bundler mode, DOM libs, `@/*` and `@rulisme/ui/*` paths) and only use this package for `motion.css`.

It's a `devDependency` across the workspace (`"@pilihpendidikan/config": "workspace:*"`). Change the shared compiler options (target, module, strictness, path base) in `tsconfig.base.json` and every consumer inherits them — verify with `bun run check-types` from the repo root afterward.

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
