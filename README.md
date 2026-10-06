# pilihpendidikan

Document builders that run in the browser and export print-ready PDFs:

| App | What it builds | Dev | Production |
| --- | -------------- | --- | ---------- |
| `apps/cv` | CVs, four templates (basic, harvard, simple, standard) | <http://localhost:4003> | <https://cv.pilihpendidikan.com> |
| `apps/invoice` | Invoices with Indonesian region (wilayah) addresses | <http://localhost:4004> | <https://invoice.pilihpendidikan.com> |
| `apps/portfolio` | Apple Developer Academy portfolios, A4 landscape | <http://localhost:4005> | <https://portfolio.pilihpendidikan.com> |
| `apps/api` | Backend Worker: cloud save, sign-in, personal tokens, MCP server | <http://localhost:8788> | <https://api.pilihpendidikan.com> |

Every app is bilingual (English at `/`, Indonesian at `/id`), keeps a local
draft in the browser, and can save to the cloud with a personal token minted at
<https://api.pilihpendidikan.com/connect>. AI assistants can edit the same
documents through the MCP server at `https://api.pilihpendidikan.com/sse`.

`apps/api` arrives in a follow-up change. Until it runs locally, the editors,
local drafts and PDF/JSON export work; loading and saving cloud documents
does not.

## Requirements

- [Bun](https://bun.sh) 1.4.2 or newer
- Node 22.22+, 24.15+ or 26+ (for tooling that shells out to Node)

## Getting started

```sh
bun install
bun dev            # builds @rulisme/ui, then runs every app
bun run dev:cv     # or one app: dev:cv, dev:invoice, dev:portfolio
```

The apps import `@rulisme/ui` from its built `dist/`. `bun dev` and
`bun run build` build it first; if you run an app on its own, run
`bun run build` in `packages/ui` beforehand.

## Checks

```sh
bun x ultracite fix   # format and autofix (Biome, Ultracite rules)
bun run check         # biome → turbo lint → typography lint → parity → tests → audit
bun run build         # packages/ui, then each app (wrangler types + vite build)
```

## Layout

```
apps/cv  apps/invoice  apps/portfolio   TanStack Start apps on Cloudflare Workers
apps/api                                backend Worker (follow-up change)
packages/ui                             @rulisme/ui component library
packages/config                         @pilihpendidikan/config (tsconfig base, motion.css)
scripts/                                typography lint + parity checks
openspec/                               change proposals and specs
docs/archive/                           reports written before the extraction
portfolio-mock/                         the static mock the portfolio app was built from
```

## Deploy

```sh
bun run build
cd apps/cv && bun run deploy   # likewise apps/invoice, apps/portfolio
```

Each `wrangler.jsonc` binds its Worker (`cv-pilihpendidikan`,
`invoice-pilihpendidikan`, `portfolio-pilihpendidikan`) to its custom domain.

## History

These apps were extracted from the `bahrul` monorepo (where they lived as
`apps/cv-bahrul`, `apps/invoice-bahrul` and `apps/portfolio-bahrul`) with
`git filter-repo`, so `git log` carries their full history. The commit
"Import working tree from bahrul" holds the edits that were uncommitted at
extraction time. Reports in `docs/archive/` and `og-metadata-audit.md`
predate the move and still refer to the old `*.bahrul.me` hosts.

See `CLAUDE.md` for conventions, `DESIGN.md` for the Warp design system and
`TYPOGRAPHY.md` for the enforced type rules.
