# packages/config — Shared TypeScript Base (@bahrul/config)

The workspace's shared TypeScript config. Provides `tsconfig.base.json`; no source code, no build step.

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
