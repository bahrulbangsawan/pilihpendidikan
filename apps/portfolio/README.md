# Portfolio Builder (`apps/portfolio`)

Bilingual (EN/ID) **portfolio builder** that edits up to 5 projects and renders a
locked **Apple Developer Academy** A4-landscape portfolio, downloadable as PDF
and JSON. TanStack Start (SSR) on Cloudflare Workers (Worker
`portfolio-pilihpendidikan`). Host: <https://portfolio.pilihpendidikan.com>.

## Develop

```sh
bun install                 # from the repo root
bun run dev:portfolio       # builds @rulisme/ui, then vite dev on http://localhost:4005  (EN: /, ID: /id)
```

## Verify

```sh
bun x ultracite fix         # from the repo root: Biome format + autofix
bun run check               # from the repo root: Biome, typography lint, parity, tests
bun run typecheck           # in this app: wrangler types + tsc --noEmit
```

## What it does

- **Editor** (left): owner profile + affiliation (student/alumni/professional/
  independent) + contact, and up to **5 projects**. Every text field is clamped
  to its `LIMITS` character cap; Scope-of-Work / Technologies / Disciplines are
  bounded chip lists. Project images must be **exactly 16:9** — other ratios are
  rejected with a user-facing error.
- **Preview** (right): a fixed-footprint A4-landscape document — a dark cover
  plus one page per project (fixed 16:9 image slot, bounded bullet list,
  line-clamped fields), scaled to fit the pane.
- **Export**: PDF (`@react-pdf/renderer`; the toolbar's **Download PDF** button
  or the `D` key) or JSON (the format menu beside it). Re-import JSON
  round-trips.
  `?print=1` renders the chrome-free document and fires the browser print dialog
  (powers the `/portfolio/<slug>.pdf` redirect on `apps/api`).
- **Cloud save**: paste a personal MCP token (from
  `api.pilihpendidikan.com/connect`) to save a loaded `?portfolio=<slug>`
  document; saves are Bearer-gated and server-authoritative.

See `CLAUDE.md` for structure and the locked-layout rules.
