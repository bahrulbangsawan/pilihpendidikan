# apps/home verification

Screenshots of the production build (`vite build` + `vite preview`, workerd),
taken with agent-browser on 2026-10-06 in a fresh browser profile.

| File | State | Viewport |
| --- | --- | --- |
| `all-soon-en-1440.png`, `all-soon-id-1440.png` | every service `"soon"` (as shipped) | 1440 × 900, full page |
| `all-soon-en-390.png`, `all-soon-id-390.png` | every service `"soon"` (as shipped) | 390 × 844, full page |
| `cv-live-en-1440.png`, `cv-live-id-1440.png` | `cv` temporarily `"live"`, the rest `"soon"` | 1440 × 900, full page |
| `cv-live-en-390.png`, `cv-live-id-390.png` | `cv` temporarily `"live"`, the rest `"soon"` | 390 × 844, full page |

Checked on every screenshot:

- `document.documentElement.scrollWidth - clientWidth` is `0` (no horizontal
  scroll).
- Links on the page: all `"soon"`: `/`, `/id`, `https://bahrul.me` only;
  `cv` live: those plus `https://cv.pilihpendidikan.com` (English page) or
  `https://cv.pilihpendidikan.com/id` (Indonesian page).
- No JavaScript errors (`agent-browser errors` empty).

The `cv` flip was reverted afterwards; `src/config/services.ts` ships every
service as `"soon"`.

## Production (after the first deploy, 2026-10-06)

`production-{en,id}-{1440,390}.png` are the live site at
`https://pilihpendidikan.com` (Worker version `9a35adaf`), taken right after
`wrangler deploy`. Same checks: no horizontal scroll, links only `/`, `/id` and
`https://bahrul.me`, no JavaScript errors, and `https://www.pilihpendidikan.com/id`
lands on `https://pilihpendidikan.com/id`.
