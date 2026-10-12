# pilihpendidikan

Document builders that run in the browser and export print-ready PDFs, plus
the hub page at the apex domain:

| App | What it builds | Dev | Production |
| --- | -------------- | --- | ---------- |
| `apps/home` | Hub landing page: lists the builders, linking each one only once it is live | <http://localhost:4002> | <https://pilihpendidikan.com> (`www.` 301s here) |
| `apps/cv` | CVs, four templates (basic, harvard, simple, standard) | <http://localhost:4003> | <https://cv.pilihpendidikan.com> |
| `apps/invoice` | Invoices with Indonesian region (wilayah) addresses | <http://localhost:4004> | <https://invoice.pilihpendidikan.com> |
| `apps/portfolio` | Apple Developer Academy portfolios, A4 landscape | <http://localhost:4005> | <https://portfolio.pilihpendidikan.com> |
| `apps/api` | Backend Worker: cloud save, sign-in, personal tokens, MCP server | <http://localhost:8788> | <https://api.pilihpendidikan.com> |
| `apps/design` | The Zedative design system page: tokens, type roles, every component | <http://localhost:4006> | not deployed |

Every app is bilingual (English at `/`, Indonesian at `/id`), keeps a local
draft in the browser, and can save to the cloud with a personal token minted at
<https://api.pilihpendidikan.com/connect>. AI assistants can edit the same
documents through the MCP server at `https://api.pilihpendidikan.com/mcp`
(Streamable HTTP; legacy clients use `/sse`).

## Requirements

- [Bun](https://bun.sh) 1.4.2 or newer
- Node 22.22+, 24.15+ or 26+ (for tooling that shells out to Node)

## Getting started

```sh
bun install
bun dev            # builds @rulisme/ui, then runs every app and the api Worker
bun run dev:cv     # or one app: dev:home, dev:cv, dev:invoice, dev:portfolio, dev:design, dev:api
```

### Running the API locally

The apps call `http://localhost:8788` in dev. `bun dev` starts the api
Worker there alongside them; to run it on its own:

```sh
cd apps/api
bun run db:migrate:local   # once: create the local D1 tables
bun run dev                # wrangler dev on http://localhost:8788
```

Open <http://localhost:8788/connect>, enter any email address and follow the
sign-in link wrangler prints in the terminal (local email is simulated). Mint
a token there and paste it into an app's "Connect via MCP" dialog to try
cloud save. No Cloudflare login is needed for local development.

The apps compile `@rulisme/ui` straight from `packages/ui/src` (TypeScript
`paths` plus Vite's `resolve.tsconfigPaths`), so a component change shows up
in every running app without a library build. `bun run build` still emits
its `dist/` for the package exports.

## Checks

```sh
bun x ultracite fix   # format and autofix (Biome, Ultracite rules)
bun run check         # biome → turbo lint → style lint → theme parity → tests → audit
bun run build         # packages/ui, then each app (wrangler types + vite build)
```

## Layout

```
apps/home                               hub landing page (pilihpendidikan.com)
apps/cv  apps/invoice  apps/portfolio   TanStack Start apps on Cloudflare Workers
apps/api                                backend Worker (api.pilihpendidikan.com)
apps/design                             Zedative design system page (localhost:4006)
packages/ui                             @rulisme/ui component library + the Zedative theme
packages/config                         @pilihpendidikan/config (tsconfig base, motion.css)
scripts/                                style lint + theme parity checks
openspec/                               change proposals and specs
docs/archive/                           reports written before the extraction
portfolio-mock/                         the static mock the portfolio app was built from
```

## Deploy

The hub (`apps/home`) has no backend dependency and can deploy on its own.
The builders' first deploy needs Cloudflare resources created and data
migrated, in a fixed order: see [`DEPLOY.md`](DEPLOY.md). After that:

```sh
bun run build
cd apps/api && bun run deploy  # the backend first
cd apps/cv && bun run deploy   # then apps/invoice, apps/portfolio
```

Each `wrangler.jsonc` binds its Worker (`home-pilihpendidikan`,
`api-pilihpendidikan`, `cv-pilihpendidikan`, `invoice-pilihpendidikan`,
`portfolio-pilihpendidikan`) to its custom domain.

The hub links a builder only when its entry in
`apps/home/src/config/services.ts` is `"live"`. When a subdomain goes live,
follow the **Going live** checklist in `DEPLOY.md`.

## History

These apps were extracted from the `bahrul` monorepo (where they lived as
`apps/cv-bahrul`, `apps/invoice-bahrul` and `apps/portfolio-bahrul`) with
`git filter-repo`, so `git log` carries their full history. The commit
"Import working tree from bahrul" holds the edits that were uncommitted at
extraction time. Reports in `docs/archive/` and `og-metadata-audit.md`
predate the move and still refer to the old `*.bahrul.me` hosts.

See `CLAUDE.md` for conventions, `DESIGN.md` for the Zedative design system
and `TYPOGRAPHY.md` for the enforced type rules. Run `bun run dev:design` to
browse the system.
