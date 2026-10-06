# Invoice Builder (`apps/invoice`)

A bilingual (English/Indonesian) invoice builder with a live preview and PDF
export. Production: <https://invoice.pilihpendidikan.com>.

## Features

- Sender and recipient details with an Indonesian address cascade (province → city → district)
- Line items with sub-items, adjustments, custom fields and period ranges
- Live preview and PDF export with `@react-pdf/renderer`, plus JSON export and import
- Per-invoice accent colour and logo
- Local draft in the browser; prefill with sample data
- Cloud save with a personal token from <https://api.pilihpendidikan.com/connect>, and editing through any MCP client

## Tech Stack

- [TanStack Start](https://tanstack.com/start) on [Cloudflare Workers](https://workers.cloudflare.com)
- [React 19](https://react.dev), [Tailwind CSS v4](https://tailwindcss.com), `@rulisme/ui` (shadcn/ui-based, `packages/ui`)
- [TypeScript](https://www.typescriptlang.org), [Bun](https://bun.sh), Biome, Vitest

## Getting Started

From the repo root:

```bash
bun install
bun run dev:invoice
```

The app runs at <http://localhost:4004> (English at `/`, Indonesian at `/id`).
Cloud save talks to `apps/api` on <http://localhost:8788> in dev.

## Regional data

`src/data/wilayah/*.json` is generated from `wilayah.sql` by
`bun run scripts/parse-wilayah.ts`.

## Deploy

```bash
bun run build
bun run deploy   # Worker invoice-pilihpendidikan → invoice.pilihpendidikan.com
```
