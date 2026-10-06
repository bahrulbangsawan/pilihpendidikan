# CV Builder (`apps/cv`)

A bilingual (English/Indonesian) CV builder with a live preview and PDF
export. Production: <https://cv.pilihpendidikan.com>.

## Features

- Form sections for personal info, summary, experience, education, skills, awards, certificates, languages, projects and volunteering
- Four templates (basic, harvard, simple, standard) with a live preview
- PDF export with `@react-pdf/renderer`, plus JSON and Markdown export and JSON import
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
bun run dev:cv
```

The app runs at <http://localhost:4003> (English at `/`, Indonesian at `/id`).
Cloud save talks to `apps/api` on <http://localhost:8788> in dev.

## Deploy

```bash
bun run build
bun run deploy   # Worker cv-pilihpendidikan → cv.pilihpendidikan.com
```
