# portfolio-bahrul

Bilingual (EN/ID) **portfolio builder** that edits up to 5 projects and renders a
locked **Apple Developer Academy** A4-landscape portfolio, downloadable as PDF
and JSON. TanStack Start (SSR) on Cloudflare Workers. Host: `portfolio.bahrul.me`.

## Develop

```sh
bun install                 # from the repo root
bun run --cwd packages/ui build   # build the shared @rulisme/ui dist first
bun dev                     # vite dev on http://localhost:4005  (EN: /, ID: /id)
```

## Verify

```sh
bun run typecheck           # tsc --noEmit (the gate; this app is excluded from Biome)
bun run format              # Prettier (no-semicolon style)
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
- **Export**: PDF (`@react-pdf/renderer`) or JSON. Re-import JSON round-trips.
  `?print=1` renders the chrome-free document and fires the browser print dialog
  (powers the `/portfolio/<slug>.pdf` redirect).
- **Cloud save**: paste a personal MCP token (from `mcp.bahrul.me`) to save a
  loaded `?portfolio=<slug>` document; saves are Bearer-gated and
  server-authoritative.

See `CLAUDE.md` for structure, the toolchain caveat, and the locked-layout rules.
