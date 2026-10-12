# 12 — UI/UX Specification (`apps/jobs`)

`apps/jobs` is the primary user interface of the Job Tracker. This document
covers its routes and layouts, each screen with its data, states, interactions
and responsive behaviour, the CLI-integration and monitoring screens,
accessibility, copy, the polling strategy, and the design-system compliance
checklist. The visual language is **Zedative** (`zedative.DESIGN.md`, as
implemented in the root `DESIGN.md` § Implementation). There is no
jobs-specific visual system (D-24).

Legend: see `00-README.md` §2.

---

## 1. App shell and platform

| Item | Value |
|---|---|
| Framework | TanStack Start (SSR) on Cloudflare Workers, `@cloudflare/vite-plugin` — same stack as `apps/cv` **[VERIFIED]** (`apps/cv/wrangler.jsonc`, `vite.config.ts`) |
| Worker / domain / dev port | `jobs-pilihpendidikan` / `jobs.pilihpendidikan.com` / **4007** |
| Server entry | `src/server.ts` wrapping `createServerEntry` (pattern of `apps/home/src/server.ts` **[VERIFIED]**) to add security headers (CSP with nonce, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `X-Robots-Tag: noindex`) |
| Data layer | **[NEW]** `@tanstack/react-query` (not yet in the workspace) over TanStack Start server functions; server functions call `apps/api` through the `API` service binding (D-15) |
| Session | BFF cookie `__Host-jobs-session` (HttpOnly, Secure, SameSite=Lax, Path=/). [DECISION] The cookie value is the API bearer encrypted with AES-GCM under the Worker secret `BFF_COOKIE_KEY`, so the BFF needs no session store (a KV session table was rejected as an extra moving part). Max-age = bearer expiry: 7 d, matching the **[VERIFIED]** browser-session TTL (`apps/api/src/session.ts:21`). Sign-out calls `/auth/logout` with the bearer, then clears the cookie. |
| Styles | `src/styles.css` = `tailwindcss` + `@pilihpendidikan/config/motion.css` + `@rulisme/ui/styles/shadcn.css` + `@rulisme/ui/styles/theme.css` + `@source` for `@rulisme/ui/dist` — **nothing else** (parity script rule **[VERIFIED]** `TYPOGRAPHY.md` § Single Source of Truth) |
| Theme | Light default; Night Desk via the `.dark` class with a toggle in Settings (builders' pattern) |
| Lint roots | **[NEW]** add `apps/jobs/src` to `scripts/lint-typography.sh`, `check-typography-parity.ts`, `check-inline-typography.ts` |

### 1.1 Sign-in flow (UX)

```text
/ (unauthenticated) ─▶ Sign-in band: email field + "Email me a link" [Enter]
     │ POST server fn → apps/api POST /auth/request {email, returnTo: "https://jobs.pilihpendidikan.com"}
     ▼
"Check your inbox" state (resend after 60 s; shows the address, change link)
     │ user clicks link → api /auth/verify confirm page → 303 to jobs origin /?code=…
     ▼
/ ?code=… ─▶ server fn calls /auth/exchange (service binding) → sets __Host-jobs-session → redirect /board
```

**[VERIFIED]** `returnTo` must exactly match an allowlisted app origin
(`apps/api/src/sign-in.ts:48-57`); adding the jobs origin is part of 05 §1.8.

### 1.2 Locale

**[DECISION D-27]** (proposed) **No `/id/*` route tree.** The builders and hub
use `/` (EN) and `/id` (ID) because they are public, SEO-indexed pages
(**[VERIFIED]** `apps/cv/src/routes/{index,id}.tsx`). `apps/jobs` is an
authenticated, `noindex` app with ~15 routes; duplicating them per locale adds
nothing. Locale is a user setting (`en` | `id`):
- the initial value comes from `Accept-Language`;
- it is stored in the cookie `jobs-lang` and in the user's settings;
- `/id` exists only as a redirect that sets `id` and goes to `/board`, so links from the Indonesian hub land correctly.

Translations use the same hand-rolled JSON-catalogue pattern as `apps/home`
(**[VERIFIED]** `apps/home/src/i18n/index.ts`), with `src/i18n/locales/{en,id}.json`.

---

## 2. Information architecture and routes

```text
src/routes/
  __root.tsx                 shell: top nav band + sidebar (signed in) / sign-in band (signed out)
  index.tsx                  /            → redirect /board (signed in) or sign-in
  id.tsx                     /id          → set locale id, redirect /board
  board.tsx                  /board       Kanban
  inbox.tsx                  /inbox       Discovery results
  jobs.$ujbId.tsx            /jobs/$ujbId Tracked-job / posting detail
  applications.$appId.tsx    /applications/$appId  Application detail + timeline
  automation.tsx             /automation  layout with tabs:
    automation.index.tsx       Approvals (default tab)
    automation.rules.tsx       Rules
    automation.runs.tsx        Runs (tasks list)
  automation.runs.$tskId.tsx /automation/runs/$tskId  Live monitor
  cli.tsx                    /cli         Connect CLI, install, devices
  sources.tsx                /sources     Job source management + discovery runs
  stats.tsx                  /stats       Analytics
  profile.tsx                /profile     tabs: Facts, Answers, CVs
  settings.tsx               /settings    Account, AI consent, evidence retention, locale, theme, export/delete
  render.cv.$cvvId.tsx       /render/cv/$cvvId  Print-only PDF render route (08)
  $.tsx                      catch-all → notFound()
```

Route-private helpers start with `-` (`-board-column.tsx`, …), per the repo
convention **[VERIFIED]** (root `CLAUDE.md` § Conventions).

### 2.1 Global chrome

```text
┌ band: nav (56px) ──────────────────────────────────────────────────────────────────────────┐
│ ◆ Pilih Jobs   Board  Inbox  Automation  Stats        ⌘K Search      ● 2 devices   [N] New │
└────────────────────────────────────────────────────────────────────────────────────────────┘
┌ sidebar (compact roles) ┬ rail (1120px max for reading pages; full width for Board) ───────┐
│ Board            B      │                                                                  │
│ Inbox  12        I      │                                                                  │
│ Approvals  3     A      │                                                                  │
│ Runs             R      │                                                                  │
│ Sources                 │                                                                  │
│ Stats                   │                                                                  │
│ ─────                   │                                                                  │
│ CLI & devices           │                                                                  │
│ Profile                 │                                                                  │
│ Settings                │                                                                  │
└─────────────────────────┴──────────────────────────────────────────────────────────────────┘
```

- **Nav band**: wordmark; primary links; `⌘K` command palette (`Command`); a device status chip (`●` pulse-dot when any device is online, `○` when none online); primary button **New** with `<Kbd>N</Kbd>` (adds a job by URL). The blue is spent **once** in the nav (the New button).
- **Sidebar**: `@rulisme/ui/ui/sidebar` with `type-body-compact` rows; counters in `type-micro tabular-nums`. On phones it collapses to a `Sheet`.
- **Command palette** (`⌘K` / `Ctrl K`): jump to an application by company/title, run actions ("Approve next", "Open inbox", "Start discovery on device…"), switch theme.
- **Toasts**: `sonner`, no enter animation (motion rules).

### 2.2 Keyboard shortcuts

Single-key shortcuts use `useShortcut` (**[VERIFIED]**
`packages/ui/src/hooks/use-shortcut.ts`: ignored in editable fields and with
modifiers) and always appear as a `Kbd` hint next to the action.

| Key | Action | Key | Action |
|---|---|---|---|
| `B` / `I` / `A` / `R` | Board / Inbox / Approvals / Runs | `N` | New job by URL |
| `⌘K` | Command palette | `/` | Focus the screen filter |
| `J` / `K` | Next / previous card or row | `Enter` | Open |
| `S` | Track selected (Inbox) | `D` | Dismiss selected (Inbox) |
| `M` | Move card (opens the stage picker) | `Y` / `X` | Approve / Reject (approval detail, with confirm) |
| `?` | Shortcut sheet | `Esc` | Close sheet/dialog |

---

## 3. Board (`/board`)

**Purpose**: the Kanban of applications (06).

```text
┌ band: toolbar (compact) ──────────────────────────────────────────────────────────────────────────┐
│ Board   Filter ▾  Mode ▾  Source ▾   ☐ Show archived              Search /       [N] New         │
├ Saved 14 ◆ ┬ Preparing 3 ┬ Ready 2 ┬ Applied 9 ┬ Interviewing 2 ┬ Offer 1 ┬ Accepted ┬ Closed ▸ ──┤
│ ┌────────┐ │ ┌─────────┐ │ ┌──────┐│ ┌───────┐ │                 │         │          │ Rejected 7 │
│ │Acme    │ │ │Globex   │ │ │Initech││ │Umbrella│ │                 │         │          │ Withdrawn 1│
│ │Frontend│ │ │Platform │ │ │SRE    ││ │Backend │ │                 │         │          │            │
│ │87 ◇ GH │ │ │CV ◐     │ │ │✓ CV   ││ │✓ Verified│                 │         │          │            │
│ └────────┘ │ └─────────┘ │ │⟳ run  ││ │ 3d ago │ │                 │         │          │            │
└────────────┴─────────────┴─┴───────┴┴─────────┴─┴─────────────────┴─────────┴──────────┴────────────┘
```

- **Columns**: `saved, preparing, ready, applied, interviewing, offer, accepted` laid out horizontally on one band, separated by `line` rules, with a **diamond node** where each column rule meets the toolbar rule. `rejected` and `withdrawn` sit in a collapsible "Closed" column on the right (collapsed by default) so terminal cards don't crowd the board.
- **Column header**: stage name (`type-subtitle weight-semibold`), count (`type-micro tabular-nums text-muted-foreground`).
- **Card** (`Card`: square, bordered, flat, `bg-card`; 2px-radius chips inside):
  - company (`type-caption text-muted-foreground`), title (`type-body weight-semibold`, two-line clamp);
  - **badges** (`Badge` `outline` unless noted):
    - **score** `87` with a tiny bar;
    - **source** (`GH`, `Lever`, `Ashby`, `Web`);
    - **mode** (`Assisted`, `Approval`, `Auto`);
    - **CV state**: `◐` generating, `CV draft`, `✓ CV`;
    - **submission**: `✓ Verified`, `? Unconfirmed` (`Badge` `default`, blue, spends attention deliberately), `! Needs review` for `outcome_unknown` in `text-destructive`;
    - **live task**: `⟳ Applying · step 4/9` with a pulse-dot;
    - **posting closed**: `Closed posting`;
  - relative time of the last change (`type-micro`).
- **Drag-and-drop**: `@dnd-kit/core` + `@dnd-kit/sortable` (**[VERIFIED]** already in the dependency tree; `packages/ui/src/form/section-list.tsx` shows the sortable pattern). Drop calls `POST /api/v1/applications/{id}/move` with `before_id`/`after_id`. The UI updates optimistically and rolls back on error. An illegal transition shows the column with a `not-allowed` cursor and an inline caption "Can't move from Applied to Preparing".
- **Keyboard alternative to DnD** (required, §11): focus a card → `M` opens a stage `Select` plus a position ("Top / Bottom / After …"); dnd-kit's `KeyboardSensor` (Space to lift, arrows to move, Space to drop) with screen-reader announcements in `aria-live="assertive"`.
- **Card open**: click or `Enter` → `/applications/$appId`. **[DECISION]** It opens as a page rather than a sheet so the URL is shareable to self/bookmarkable; on ≥ 1280px a `Resizable` split keeps the board visible on the left.
- **Data**: `GET /api/v1/board` (05 §5). **Polling** 15 s while visible (§10). Cards with a live task poll their task summary through the board payload.
- **States**:
  - loading: `Skeleton` columns;
  - empty (no applications): an `Empty` panel in the Saved column, "Track a job from your inbox or add one by URL", with buttons Inbox `I` and New `N`;
  - error: an `Alert` band with Retry;
  - stale data (poll failed 3×): a caption in the toolbar, "Offline — showing data from 14:02".
- **Phone width (< 640px)**: the board becomes a **stage switcher** (`Tabs` with counts, horizontally scrollable) plus a vertical card list. DnD is disabled; `M` / the "Move" menu is used instead. 16px side gutter.

---

## 4. Inbox — Job Discovery results (`/inbox`)

**Purpose**: review discovered postings, check scores and provenance, bulk
track or dismiss.

```text
┌ band: toolbar ─────────────────────────────────────────────────────────────────────────────────┐
│ Inbox  New 48 · Seen 120 · Dismissed      Min score [70]  Source ▾  Remote ▾  Posted ▾  /search │
├ table ─────────────────────────────────────────────────────────────────────────────────────────┤
│ ☐ │ Score │ Title                │ Company   │ Location      │ Source    │ Seen     │ Dup        │
│ ☐ │  91 ▮ │ Senior Frontend Eng. │ Acme      │ Remote (APAC) │ Greenhouse│ 2h · run │            │
│ ☐ │  —  ◌ │ Data Analyst         │ Globex    │ Jakarta       │ Career pg │ 1d       │ 2 sources  │
├ selection bar (appears when rows are selected) ────────────────────────────────────────────────┤
│ 3 selected     [S] Track   [D] Dismiss   Score   Mark seen                                      │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- `Table` with `type-body-compact` rows. Score cell: number plus a 40px bar in `primary`; `◌` = queued; `—` = not scored (AI off). A score tooltip shows the component breakdown (07).
- **Row expand** (`Collapsible`) shows the description excerpt (plain text) and the **provenance** block: adapter and version, fetch method (`official_api` / `html` / `dynamic`), run id, extraction confidence, first/last seen, posting status. Below it, the **duplicates** list: other sources that produced the same fingerprint (from `extraction.alternates`), so the user sees why one row stands for several listings.
- **Bulk actions**: Track (`S`), Dismiss (`D`), Score (re-request), Mark seen. Up to 200 per call (`POST /api/v1/inbox:bulk`). Results appear in a toast: "Tracked 3 · 1 already tracked".
- **Import status strip** (top, only when a discovery run finished in the last 24 h): "Run on *MacBook* · 14:02 · 312 found · 48 new · 12 updated · 3 invalid · 1 source blocked (Workday: access denied)", with a link to the run.
- **Data**: `GET /api/v1/inbox` with cursor pagination (infinite scroll with a "Load more" button, not auto-scroll, to keep `J`/`K` predictable). Polling 30 s while a discovery run is active on any device, otherwise none (refetch on focus).
- **Empty states**:
  - no sources: "Add a source to start discovering jobs", with a Sources button;
  - sources but no runs: "Run discovery from your CLI" plus the copyable command `pilih-jobs discover --all` in a `Kbd` chip;
  - all caught up: "No new jobs. Last run 2 h ago."
- **Phone**: the table becomes stacked rows (title, company, score badge), and selection uses long-press → a checkbox mode.

---

## 5. Tracked job (`/jobs/$ujbId`) and Application detail (`/applications/$appId`)

`/jobs/$ujbId` shows the posting, its score and its provenance. It has a
**Track** primary button when the job isn't tracked yet; once tracked it
redirects to the application.

### 5.1 Application detail layout

```text
┌ band: header ──────────────────────────────────────────────────────────────────────────────┐
│ Acme · Senior Frontend Engineer          Stage [Ready ▾]   Mode [Approval ▾]   ⋯            │
│ Remote (APAC) · Greenhouse · posted 3 d ago · Score 91 · Posting open                       │
├ two columns (1fr / 360px) ─────────────────────────────────────────────────────┬───────────┤
│ Tabs: Overview · CV · Apply · Timeline · Interviews · Offers                    │ Next step │
│                                                                                 │ ┌───────┐ │
│ (tab content)                                                                   │ │Approve│ │
│                                                                                 │ │CV  [Y]│ │
│                                                                                 │ └───────┘ │
│                                                                                 │ Live task │
│                                                                                 │ Evidence  │
└─────────────────────────────────────────────────────────────────────────────────┴───────────┘
```

- **Right rail "Next step"**: exactly one recommended action, computed from the state:
  - Generate CV;
  - Review CV;
  - Start apply (choose device);
  - Approve submission;
  - Confirm submission (`submitted_unverified`);
  - Review outcome (`outcome_unknown`);
  - Add interview.

  It is the page's only primary (blue) button.
- **Overview**: posting description (plain text, `type-body`, `max-width` 72ch), requirements list, salary, notes (autosave with `base_revision`), follow-up date.
- **CV tab** (08):
  - base CV selector;
  - variant list (status badges);
  - a **diff view** of the tailored variant against the base (added/removed/reordered bullets shown in `bg-highlight`/strikethrough; every changed bullet links to its source bullet);
  - PDF preview (`iframe` of the R2 content route, `sandbox`);
  - buttons: Approve `Y`, Reject, Regenerate, Download.
- **Apply tab**:
  - method: browser, email or manual;
  - mode;
  - target device (`Select` of online devices that have the capability `apply`, plus "Any of my devices");
  - a start button that creates the task (`POST /api/v1/tasks`);
  - for email, the draft composer (09);
  - for manual, "I applied" (date and method), which records a `user_attestation`.
- **Timeline**: `application_events` rendered as a vertical rail. Each event is a row with a diamond node on the rule, the actor chip (You / *MacBook* CLI / System / MCP), time, and a description. Conflict events (`applied_to_state = 0`) render in `text-destructive` with "Not applied: the stage had changed to Rejected by you at 13:20".
- **Interviews / Offers**: tables with add/edit in a `Sheet`.
- **Data**: `GET /api/v1/applications/{id}` and `…/events`. Polling: 15 s; **2 s while a task for this application is `claimed`/`running`/`awaiting_approval`** (§10).

---

## 6. Automation (`/automation`)

### 6.1 Approval queue (default tab)

**Purpose**: decide submissions, sensitive answers, CV variants and rule activations.

```text
┌ list (360px) ───────────────────┬ detail ─────────────────────────────────────────────────────────┐
│ ● Submit · Acme · 4 min ago      │ Submit application to Acme — Senior Frontend Engineer           │
│   Answer · Globex · "Visa?"      │ Expires in 23 h 56 m · from MacBook (dev_…) · attempt 1         │
│   CV · Initech · draft           │ ┌ Filled fields ─────────────────────────────────────────────┐  │
│                                  │ │ Label            │ Value                  │ Source          │  │
│                                  │ │ Email            │ r…@gmail.com           │ Fact: contact…  │  │
│                                  │ │ Resume           │ acme-t-k3….pdf (sha ✓) │ CV variant      │  │
│                                  │ │ Years of React   │ 5                      │ Answer bank     │  │
│                                  │ └──────────────────────────────────────────────────────────┘  │
│                                  │ Screenshot of review page (thumbnail → zoom)                    │
│                                  │ Final URL  boards.greenhouse.io/acme/jobs/123                   │
│                                  │ [Y] Approve and submit        [X] Reject        Open in run ›   │
└──────────────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

- **Approve** opens a confirm `AlertDialog`: "Submit this application to Acme? This can't be undone." The decision is sent with `payload_hash` (05 §8). If the hash no longer matches (the form changed), the UI shows "The form changed since this was prepared. The agent will ask again."
- **Answer approvals** show the question, the options, the suggested answer with provenance, and an input for the user's own answer, plus a checkbox "Save to my answer bank" (with sensitivity preselected; `protected` answers can be saved with `auto_use = approval` at most).
- **Sources of values are always visible**: fact key, answer bank entry, CV variant, or "Typed by you". Values are masked by default for contact fields, with a reveal toggle.
- Badge counts appear in the sidebar (`Approvals 3`). The browser tab title is prefixed `(3)` when approvals are pending.
- Polling: 10 s on this tab; the sidebar count is refreshed with the board poll.
- Empty: "Nothing to approve."

### 6.2 Rules

`Table` of rules: name, mode, criteria summary, limits, enabled `Switch`.

- **Editor** (`Sheet`, `Field` components): criteria (min score `Slider`, keywords, locations, sources, workplace types), limits (max/day, max per company per 30 days, active hours, expiry), allowed domains (auto mode: required, chips with validation), CV policy.
- Enabling an `auto` rule:
  1. creates a `rule_activation` approval;
  2. shows the confirmation dialog with a plain-language summary ("Up to 5 applications a day to Greenhouse and Lever jobs scoring 85+ …");
  3. requires typing the rule name to confirm.

### 6.3 Runs (`/automation` → Runs tab) and live monitor (`/automation/runs/$tskId`)

Runs tab: a table of tasks (kind, application, device, state badge, attempt,
started, duration), filterable by state. Failed and `outcome_unknown` rows
have a **Retry** button (with a confirmation for `outcome_unknown`: "Did this
application go through? Check your email first." with the options Submitted /
Not submitted / Not sure).

**Live monitor**:

```text
┌ header: Applying to Acme · task tsk_… · attempt 2 · MacBook (online ●) · Approval mode ────────┐
├ stepper (left, 280px) ────────┬ detail ─────────────────────────────────────────────────────────┤
│ ✓ Claimed            14:02:01 │ Current: Filling form (page 2 of 3)                             │
│ ✓ CV ready (sha ✓)   14:02:03 │ Executor: running · headed browser · 23/60 actions · 6/25 AI    │
│ ✓ Opened apply page  14:02:07 │ ┌ step log (aria-live polite) ───────────────────────────────┐  │
│ ● Filling form       14:02:15 │ │ 14:02:19 fill  "First name" ← fact contact.first_name      │  │
│ ○ Review             —        │ │ 14:02:20 upload "Resume" ← cvv_… (sha ✓)                    │  │
│ ○ Approval           —        │ │ 14:02:24 choose "Next" (confidence 0.94)                    │  │
│ ○ Submit             —        │ └───────────────────────────────────────────────────────────────┘  │
│ ○ Verify             —        │ [Cancel run]                     Last heartbeat 4 s ago           │
└───────────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

- **Stepper stages** map to task progress `stage` values (21): `claimed, preparing_cv, opening, filling, reviewing, awaiting_approval, submitting, verifying, done`.
- **Executor status**: `running`, `paused(reason)`, `awaiting_approval`, or `sync_pending` ("Finished on device — waiting to sync"), plus browser mode, action/AI counters, and the last heartbeat age. If the heartbeat age is > 60 s, show "Device not responding — the run will be released at 14:05".
- **Intervention prompts**: on `paused`, a prominent `Alert` explains why and what to do. One message per canonical `pause_reason` (03 §7.2), for example:
  - `login_required`, `account_creation_required`, `mfa_required`, `credential_field`: "Log in (or finish the step) in the browser window on MacBook, then press Resume in the terminal or here";
  - `captcha_or_challenge`: "Complete the check in the browser window yourself";
  - `protected_question`, `missing_information`, `unknown_question`: link to the pending `answer` approval;
  - `off_domain_navigation`, `unsupported_form`, `unclear_page`, `low_confidence`, `validation_unresolved`, `stuck_loop`: "Take over in the browser, or cancel";
  - `injection_suspected`: show the flagged excerpt;
  - `needs_headed_restart`, `payment_requested`, `network_offline`, `resource_exhausted`, `ai_unavailable`, `user_requested`: explain and offer Resume or Cancel.

  The **Resume** button sends a `resume` command, delivered through heartbeat (21).
- **CV attachment status**: shown in the stepper (`CV ready (sha ✓)` / `rendering` / `missing`).
- **Outcome**: the final card shows the submission status, the evidence summary (signals, final URL, screenshot) and buttons Confirm / Not submitted for unverified outcomes.
- **Step log** comes from the redacted events (21 §6). Values are shown by source (`← fact contact.first_name`), never raw (11 §8).
- Polling: 2 s while the task is non-terminal and the tab is visible; 10 s if hidden; stop when terminal.

---

## 7. CLI & devices (`/cli`)

**Purpose**: connect the CLI, install instructions, device management, sync
and execution visibility.

```text
┌ band: Connect your computer ────────────────────────────────────────────────────────────────────┐
│ 1 Install     macOS ▸ Windows ▸ Linux     [copy] uv tool install pilih-jobs                      │
│ 2 Install the browser                     [copy] pilih-jobs browser install                      │
│ 3 Sign in                                 [copy] pilih-jobs login     → opens this site to approve│
├ band: Devices ──────────────────────────────────────────────────────────────────────────────────┤
│ Name           │ Status      │ Last sync   │ Version │ Active work            │ Tasks │ ⋯          │
│ MacBook (macOS)│ ● Online    │ 12 s ago    │ 1.2.0   │ Discovery: 2 sources ⟳ │ On    │ Rename/Revoke│
│ Desktop (Win)  │ ○ Offline 3d│ 3 d ago     │ 1.1.4 ⚠ │ —                      │ Off   │            │
├ band: Recent activity ──────────────────────────────────────────────────────────────────────────┤
│ Execution logs (latest 20 attempts, link to run) · Failed operations [Retry] · Outbox warnings  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Install instructions per OS** (tabs). The commands are defined in 22. Each block is a copyable command chip (`Kbd`-styled caption) with a copy button and a "Requires: Python 3.12 via uv (installed automatically by the installer script)" caption. A link offers the alternative installers (Homebrew tap, Scoop, pipx).
- **Consent page for CLI login**: the OAuth consent screen is served by `apps/api` (17), not `apps/jobs`, but uses the same Zedative look via `htmlPage()`. `/cli` explains it in advance: "You'll be asked to approve *Pilih Jobs CLI* on *device name*".
- **Device row**:
  - **Status**: `active` (`●` pulse-dot) when it holds a lease with a heartbeat ≤ 90 s; `online` when `last_seen_at` ≤ 6 min; else offline with relative time (04 §1).
  - **Last sync**: the device's last successful outbox flush (from heartbeat).
  - **Version**: a `⚠` badge when below `recommended_cli_version`; a destructive badge when below `min_cli_version`.
  - **Active work**: running discovery runs and apply tasks with links.
  - **Tasks**: the `accepts_tasks` switch (PATCH device).
  - **Revoke**: an `AlertDialog` naming the consequences ("Signs this device out. 1 running task will be stopped; if it already started submitting, it will be marked for review."), followed by `POST /devices/{id}/revoke`.
- **Retry failed operations**: tasks in `failed` with `retryable` errors and discovery runs in `failed`/`partial`. Each offers **Retry** (creates a new task / discovery task) with the device selector.
- **Outbox warnings**: devices reporting `outbox_depth > 0` for > 1 h or dead-lettered items. Shows "MacBook has 3 changes that couldn't sync" and how to fix it (`pilih-jobs sync --status`).
- Polling: 10 s while the page is visible.
- Empty (no devices): the connect band is the hero (title role, not display), with the steps.

---

## 8. Sources (`/sources`)

- **Source list** (`Table`): label, adapter (with the capability icons discovery/pagination/details/incremental/application-support from the adapter manifest), config summary (board token, URL), last run, last success, enabled switch, "Run now" (creates a `discover` task for a selected device).
- **Add source** (`Sheet`): adapter picker from `GET /api/v1/sources/adapters`. Restricted adapters are shown disabled with the reason. LinkedIn and Indeed are listed as "Not supported — their terms prohibit automated access" (D-17), so the user isn't left wondering. Workday shows an opt-in warning (C-11). The adapter-specific config form is rendered from the manifest's JSON Schema (simple field mapping: string, url, enum, boolean). "Test" runs nothing server-side (11 T-08); it shows the CLI command to test: `pilih-jobs discover --source src_… --dry-run`.
- **Discovery runs** (`Table`): run id, device, sources, status, stats (found/new/updated/duplicates/invalid), errors by class (`access_denied`, `challenge_detected`, `rate_limited`, `parse_error`, `network`; 15 §8), duration.

---

## 9. Stats (`/stats`), Profile (`/profile`), Settings (`/settings`)

- **Stats** (10): four stat cells at the top (Applications, Response rate, Interviews, Offers), `type-title tabular-nums`, with **display role reserved for the page title only**. Below them:
  - a funnel chart (horizontal bars, `chart` with `--chart-1..5`);
  - a weekly time series;
  - breakdowns by source, mode and CV variant;
  - median time-to-response.

  A date range picker sits in the toolbar band. Charts include a data table toggle (accessibility).
- **Profile**:
  - **Facts**: a grouped form (contact, links, work authorization, education, preferences), each fact with a source chip (`From CV`, `You`).
  - **Answers**: a table plus an editor. The sensitivity select defaults `protected` for known protected keys and disables "Always".
  - **CVs**: base CV list with links to `cv.pilihpendidikan.com/?id=…`, and an "Import facts from CV" action.
- **Settings**:
  - account (email, sign out);
  - AI consent switch (11 §11);
  - evidence screenshots and retention;
  - "Allow AI assistants (MCP) to answer questions and approve CV variants" (`allow_mcp_approvals`, default off; never submissions or rule activation, 11 §4.9);
  - default application mode;
  - locale;
  - theme;
  - **Export data**, **Delete account** (11 §10) in a destructive band at the bottom.

---

## 10. Polling strategy (no WebSockets in v1, D-11)

| Screen / element | Interval (visible) | Hidden tab | Notes |
|---|---|---|---|
| Board | 15 s | paused | Refetch on focus. [DECISION] No faster polling for cards with a live task: the board shows only a task summary badge; live progress belongs to the run monitor |
| Application detail | 15 s; **2 s** while a task is live | 10 s if live, else paused | |
| Live run monitor | **2 s** | 10 s | Stops at a terminal state |
| Approvals tab | 10 s | 60 s | The pending count also drives the tab title |
| Inbox | 30 s while any discovery run is `running`; else none | paused | |
| CLI & devices | 10 s | paused | |
| Sidebar counts | piggyback on the active screen's poll (`/api/v1/board` includes `counts`) | — | |

Implementation:
- TanStack Query `refetchInterval` with `refetchIntervalInBackground: false`, except the live monitor (10 s background).
- Exponential backoff on errors: 2× up to 60 s.
- The `ETag`/`If-None-Match` support on `GET /board` and `GET /tasks/{id}` (**[NEW]**, server returns `304`) keeps the cost low.

Server cost is in 14 §9.

---

## 11. Conflict UX (revision conflicts)

- Every mutation sends `base_revision`. On `409 revision_conflict` the client receives `details.current`.
- **Non-overlapping fields** (for example, the user edited notes while the CLI changed the stage): auto-merge, re-send with the new revision, and show a toast "Updated with changes from MacBook".
- **Overlapping fields** (both changed the stage):
  1. **do not** auto-retry;
  2. revert the optimistic update;
  3. show a toast with the conflict, e.g. "Acme moved to Applied by MacBook CLI at 14:03. Your move to Rejected wasn't applied." with the actions **Apply mine anyway** (re-send with the new `base_revision`) and **Keep theirs**.
- Notes use a 3-way merge of plain text (diff-match-patch) when possible; otherwise a `Dialog` shows both versions side by side.
- DnD conflicts snap the card back to the server position with the same toast.

---

## 12. Accessibility

- WCAG 2.2 AA target. Contrast comes from the measured token pairs (**[VERIFIED]** `DESIGN.md` § Measured contrast: muted text ≥ 4.54:1 on every surface, light and Night Desk). Hairlines below 3:1 are a known, accepted spec choice, so **state is never conveyed by a hairline alone**: selected rows also get `bg-pane-2` and `weight-semibold`.
- Focus: the theme's focus recipes (**[VERIFIED]** `DESIGN.md` § Focus). Never remove outlines.
- **DnD**: a keyboard sensor plus the "Move to…" menu (`M`). Announcements: "Picked up Acme, Senior Frontend Engineer, in Saved. Position 2 of 14." / "Moved to Ready."
- **Live regions**:
  - the run monitor's step log: `aria-live="polite"`, at most one announcement per 5 s (summarized);
  - pause/approval prompts: `role="alert"`;
  - toasts: polite.
- Status is never colour-only: icons plus text (`✓ Verified`, `? Unconfirmed`, `! Needs review`).
- Charts include tabular alternatives. The `Kbd` hints have `aria-keyshortcuts` on their buttons.
- Touch targets ≥ 36px (default control height **[VERIFIED]** `DESIGN.md` § Component recipes); inputs use `field-touch` (16px on coarse pointers).
- `prefers-reduced-motion`: pulse-dots stop (**[VERIFIED]** motion rules); DnD movement stays (functional, per `DESIGN.md` § Deviations).

---

## 13. Copy guidelines (EN / ID)

- Sentence case everywhere (**no uppercase**, design rule). Short, direct verbs: "Track", "Dismiss", "Approve and submit".
- Never overstate certainty. Use "Unconfirmed" and "Needs review", never "Submitted" unless verified (D-18).
- Name the device and the actor: "MacBook moved this to Applied".
- Explain refusals with the rule: "Not supported — LinkedIn's terms prohibit automated access."
- Indonesian strings use the same neutral, formal-but-friendly register as `apps/home/src/i18n/locales/id.json` (**[VERIFIED]** exists). Key glossary:

| EN | ID |
|---|---|
| Board | Papan |
| Inbox | Kotak masuk |
| Track | Lacak |
| Dismiss | Abaikan |
| Approve and submit | Setujui dan kirim |
| Needs review | Perlu ditinjau |
| Unconfirmed | Belum terkonfirmasi |
| Device | Perangkat |
| Approval | Persetujuan |
| Application | Lamaran |
| Interview | Wawancara |
| Offer | Tawaran |

- Stage names in ID: Disimpan, Persiapan, Siap, Dilamar, Wawancara, Tawaran, Diterima, Ditolak, Ditarik.

---

## 14. Design-system compliance checklist

Every screen must pass these before merge (CI enforces the starred items):

- [ ] ★ `type-*` roles only; no `text-xs/sm/base/lg…`, no `text-[…]`, no `leading-*`, no `tracking-*` (`lint:typography`).
- [ ] ★ No `uppercase` / `capitalize`; sentence case.
- [ ] ★ Weights only via the role defaults or `weight-normal/semibold/bold` (400/550/700); `weight-bold` only with `type-display`, once per page (the page title).
- [ ] ★ No hex in classes; tokens only; no `dark:` manual colours.
- [ ] ★ No gradients, `backdrop-blur`, or enter/exit animations.
- [ ] ★ Radii: cards/tables/bands/sheets `rounded-none`; chips/badges/kbd `rounded-sm` (2px); buttons/inputs `rounded-md` (4px); windows (dialog, popover, command, toast) `rounded-lg` (6px); nothing larger.
- [ ] ★ `apps/jobs/src/styles.css` imports the shared theme and defines no tokens (`parity:typography`).
- [ ] Blue (`primary`) at most twice per viewport: the nav **New** button and the page's single primary action. Scores and links may use `text-primary` sparingly.
- [ ] Bands and rails: each page section is a `Band`; reading pages use `Rail` (1120px) with diamond nodes; the Board uses full-width bands with diamonds at column-rule crossings.
- [ ] Compact roles (`-compact`) in toolbars, sidebars, tables and filter bars; default roles elsewhere.
- [ ] Every primary action has a `Kbd` hint and a registered `useShortcut`.
- [ ] Body copy in `ink` (inherited); headings/labels `text-foreground`; meta `text-muted-foreground`; errors `text-destructive`.
- [ ] Motion: 150ms standard curve only on colour/opacity/box-shadow; `press` on buttons; no route transitions.
- [ ] Light and Night Desk both reviewed at 375px and 1280px with `agent-browser` screenshots (root `CLAUDE.md` § Browser testing).
- [ ] No component forked per app; re-skins go into `packages/ui` (root `CLAUDE.md` § Conventions).

---

## 15. Hub integration (`apps/home`)

**[VERIFIED]** `apps/home/src/config/services.ts` drives the hub cards, JSON-LD
and `/llms.txt`. Steps (roadmap M1, flip to live at the end of M2):

1. Add `"jobs"` to `ServiceId`, add `jobs: { status: "soon", url: "https://jobs.pilihpendidikan.com" }` to `SERVICES`, and append `"jobs"` to `TOOL_IDS`.
2. Add `services.jobs.name` / `services.jobs.description` to `src/i18n/locales/{en,id}.json`. EN: "Job tracker" / "Track applications on a board, discover jobs and apply from your computer with the CLI." ID: "Pelacak lamaran" / "Lacak lamaran di papan, temukan lowongan, dan lamar dari komputer Anda dengan CLI."
3. Update the `hub-page.test.tsx` fixtures.
4. Update the MCP description copy ("CVs, invoices, portfolios and job applications").
5. Follow `DEPLOY.md` § Going live (deploy → smoke-test → flip to `live` → redeploy the hub).
