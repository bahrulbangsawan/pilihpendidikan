# packages/config — Shared TypeScript Base (@bahrul/config)

The workspace's shared config. Provides `tsconfig.base.json` and `motion.css`; no source code, no build step.

## `motion.css` — shared motion primitives

Every UI app (`web`, `mcp-ui`, `cv-bahrul`, `invoice-bahrul`, `portfolio-bahrul`) imports it right after `tw-animate-css`:

```css
@import "@bahrul/config/motion.css";
```

It owns the motion tokens (`--motion-duration-*`, `--motion-ease`, `--motion-press-scale`, `--motion-hover-lift`, `--motion-enter-*`, `--motion-stagger`), the `ease-standard` / `press` / `card-interactive` / `motion-enter` / `motion-stagger` / `image-fade` / `route-view` utilities, the route view-transition CSS, the Blocks spinner (`.spinner-blocks`) and the single `prefers-reduced-motion` kill switch. Change a value here, never per component.

## Usage

Apps and packages extend it in their own `tsconfig.json`:

```jsonc
{ "extends": "@bahrul/config/tsconfig.base.json" }
```

It's a `devDependency` across the workspace (`"@bahrul/config": "workspace:*"`). Change the shared compiler options (target, module, strictness, path base) in `tsconfig.base.json` and every consumer inherits them — verify with `turbo check-types` (or `bun run typecheck` in a consumer) afterward.

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
