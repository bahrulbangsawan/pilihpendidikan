# Job Tracker redesign spec (round 3)

User request (2026-11-24, verbatim): "Pada jobs: Hapus fitur inbox, approvals, runs, sources, CLI and devises (semua automation). Fokus hanya pada board, stats, profile. Full re-design everything about jobs, the layout, the components style, etc. Please use reui.io blocks as references for re-create the layout of kanban with the multiple view mode, details board, profile, settings, profile dropdown, etc. Please make sure that."

## Scope

- KEEP and redesign: board (kanban + list + table views), application details (side sheet from the board + the full page `/applications/$appId`), stats, profile, settings, the profile dropdown, sign-in, the ⌘K palette, the new-application dialog, the CV render page (`/render/cv/$cvvId`, untouched: it renders PDFs).
- REMOVE from the dashboard (`apps/jobs` only): inbox, approvals, runs (and the run monitor), rules, sources (incl. cloud sources), CLI & devices, the whole Automation section, the job detail page reached from the inbox (`/jobs/$ujbId`), and every automation surface inside kept screens (approval chips, run/task status, "opening the form on <device>", automation mode filter/selector, device presence, "Pause all automation", MCP-approval toggles, agent apply). Routes for removed pages must 404 via the existing not-found handling (or redirect to `/board`), not crash.
- DO NOT touch: `apps/api`, `apps/jobs-cli`, `apps/jobs-scraper`, `packages/jobs-contracts`, `apps/jobs/scripts/mock*` (the mock api stays as is), the `/render/cv` page, `routeTree.gen.ts` by hand (it regenerates when the dev server sees route files change; run `bun run typecheck`/vite to regenerate).
- Manual job-application features that are NOT automation stay: stages, notes, interviews, offers, follow-ups, checklists, CV variants and the CV tab, email drafts if they are user-written, timeline.

## Design language

The whole workspace is the Cursor design system = cursor.com's dark theme (read `DESIGN.md`, tokens in `packages/ui/src/styles/theme.css`): warm near-black `bg-background`, `bg-card` surfaces with `border-hairline`/`border-border`, Geist weight 400, orange `text-link` for links/active nav. Keep those tokens. Take LAYOUT and COMPOSITE-COMPONENT structure from reui.io blocks; use the shared `@rulisme/ui` primitives (Button pills, Input, Select, Sheet, DropdownMenu, Tabs, Badge, Avatar, Switch, Table…) for controls — never fork a primitive into the app.

Composite geometry from reui (allowed within the lint: radius ≤ 8px, no gradients, no hex classes, no enter animations):
- Kanban/list cards: `rounded-lg border border-border bg-card p-3`, hover `bg-pane`; columns `rounded-lg bg-card/50 border border-hairline` with a header row (status dot/icon in a semantic colour, title, count badge, column menu).
- Small status dots and status icons may use `bg-link`, `bg-success`, `bg-destructive`, `bg-offgray`, `text-ink-sec`; no new saturated palettes.
- Letter avatars for companies (`Avatar` with initials, `bg-pane-2`).

## Reference map (screenshots in `cook/refs/reui/`, dark)

| Screen | reui reference | Take |
|---|---|---|
| App shell | `app-shell-2.png` (also `app-shell-1.png`) | Left sidebar on `bg-sidebar` (card colour) ~240px: brand row (mark + "Pilih Jobs" + collapse button), search field with ⌘K, "Platform"-style group label, nav rows (Board, Stats; Profile and Settings at the bottom group), the user footer row (avatar, name/email, chevron) that opens the PROFILE DROPDOWN. Content area: top bar with breadcrumb (`Board`, `Applications / Acme — Frontend Engineer`), right-side actions. |
| Profile dropdown | user footer in `app-shell-1.png`/`app-shell-2.png` | DropdownMenu from the footer row: header (avatar, name, email), items Profile, Settings, Language submenu (English / Bahasa Indonesia), Keyboard shortcuts, separator, Sign out. |
| Board (kanban) | `kanban-board-2.png` (layout), `kanban-board-1.png` (card density), `solution-crm-2.png` (Deal Risk Board: header, legend dots, card with logo + status chip, two stat tiles, progress bar, owner row) | Page header: title "Board" + count badge, description, actions (Filters, view switcher, primary "New application"). Columns with status icon + title + count. Cards: company avatar + company, title (weight 500 allowed), location/remote line, score as a progress bar with %, chips row, footer (dates, follow-up, CV icon). Collapsed lanes like reui's vertical "Blocked/Reviewing" for Closed/Archived. Horizontal scroll with a thin scrollbar. Drag and drop keeps working (existing dnd). |
| View modes | `list-1.png`, `solution-crm-1.png` (deals table), `data-grid-base-1.png` | A segmented view switcher (Board / List / Table) persisted in the URL search (`?view=`). List = grouped by stage, one row per application (avatar, title/company, location, score, stage badge, updated). Table = sortable data grid (columns: Company/role, Stage, Score, Location, Source, Applied, Updated, actions), row selection with the existing bulk bar. |
| Application details | `sheet-1.png` (side sheet with title, property chips row, sections, footer actions) | Clicking a card/row opens a right Sheet (~520px) with header (company avatar, title, company, stage select, close), property chips (stage, score, location, source, applied date), sections (Next step, Notes, Interviews, Follow-up) and a footer: "Open full page" + primary action. The full page `/applications/$appId` uses the same header pattern with tabs (Overview, CV, Interviews, Offers, Timeline, Notes, Checklists) styled like `navbar-1.png`'s tab row. |
| Stats | `stats-1.png` (four stat cards: label, value, delta chip, "vs last month"), `solution-crm-1.png` (cards with sparklines), `stats-3.png` | Top row of 4 stat cards, then charts in cards (pipeline by stage, response rate over time) using the existing chart components restyled. |
| Profile | `profile-1.png` → actually the "Account Settings" page (left sub-nav Profile/Workspace/Team/Billing; "Profile Details" card of label/description rows with fields on the right) | Profile page = left sub-nav (Details, CVs, Facts, Answers — the existing profile tabs) + content cards of rows (label + description left, control right). |
| Settings | `settings-2.png` (Privacy & Preferences card: icon tile, title + badge, description, Switch/Button on the right, Cancel / Save footer) | Settings = same sub-nav layout as profile (Account, Language, AI, Privacy) with toggle rows in a card, footer actions. |

## Quality bar
Dark only. 1440×900 and 390×844 must both work (no horizontal page scroll except the kanban lane area). Keyboard: every action reachable, focus visible. Keep accessible names that tests rely on unless the test belongs to a removed feature (delete those tests). Typecheck, tests, `bash scripts/lint-typography.sh`, `bun x ultracite fix` must pass.
