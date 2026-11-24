# Brief: pilihpendidikan × cursor.com redesign

Target: full redesign of every pilihpendidikan web surface and the shared design system (now named Cursor, `packages/ui`) to match cursor.com: colours, buttons, sizing, spacing, typography, layout. Stack: Bun workspace, TanStack Start, Tailwind 4, `@rulisme/ui`.
References: `cook/refs/R01`–`R04` (cursor.com home, pricing, features (same as home), docs; light + dark; 1440 and 390). Recreate closely.
Measured tokens: `cook/refs/vars-{light,dark}.json`, `tokens-*.json`, `more-light.json`, `rules.css`, `type.css`.
Bar (UI mapping): layout/spacing [99], colour [99], typography [99], components (buttons, cards, inputs) [99], detail (borders, radii, icons, states) [99], motion (hover/press timing) [9/10].
Calibration offset: none yet.
Rules:
- No Cursor assets: no logo, no CursorGothic/berkeleyMono, no illustrations or screenshots, no copy. Font: Geist (OFL), measured 0.34% mean width error vs CursorGothic, identical cap height. Mono: Geist Mono.
- `bun x ultracite fix && bun run check` passes at the end of every round.
- DARK MODE ONLY (user, mid-run): cursor.com's dark theme is the one scheme; no light scheme, no theme toggles. Compare against the `*-dark-*` refs.
- AA contrast and focus rings do not regress. Copy keeps meaning and EN + ID.
- Print artifacts (PDF templates and their HTML previews) keep their look (Inter).
- Slop ban list applies.
Time: floor 8h. Started: 2026-11-23 23:30 WITA.
Usage: 5h window, about 20% per hour, never 100%.
Deliverable: commits on branch `cook/cursor-redesign` (one per round), before/after compares in `cook/compare/`. No merge to main.
Permissions: fetch cursor.com for reference only; install free fonts from npm; no push, no deploy, no publish.
User's words: "btw dark mode only, without lightmode." / "Full re-design pilihpendidikan web and that related [design system] to https://cursor.com, make sure the colors, the buttons, sizing, spacing, typography, layout, etc pixel perfect exact match."
