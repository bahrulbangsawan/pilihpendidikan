# Zedative × cursor.com — implementation spec (round 1)

Every value here was measured from cursor.com (light and dark) with computed styles. The tokens are already in `packages/ui/src/styles/theme.css`; read it first. Reference screenshots: `cook/refs/` (`R01-home-*`, `R02-pricing-*`, `R04-docs-*`; `crops/` has them sliced). Raw measurements: `cook/refs/*.json`, `rules.css`, `type.css`.

## Look in one paragraph
Warm off-white paper `#f7f7f4`, warm ink `#26251e`, everything weight 400 (Geist). Cards are one step darker (`bg-card` = `#f2f1ed`), 4px radius (`rounded-sm`), a 2.5% hairline (`border-hairline`), no shadow, padding 17.5px (15.9px top) or 15px for small text cards. Buttons are pills. Grey text is ink at 60–66% (`text-muted-foreground`, or `text-ink-sec` for ≥18px text). Dividers are ink at 10% (`border-border` / `border-line`). Orange `#f54e00` (`text-link`) is ONLY for text links ("Learn more →"), the active item in a docs-style nav, and the orange badge. No gradients, no glows, no graph paper, no diamonds, no rails borders, no hatch, no inset lips, no offset shadows, no press translate.

## Tokens (Tailwind classes)
- Surfaces: `bg-background` page · `bg-card` card (#f2f1ed) · `bg-pane` (#ebeae5, hover fill / chips) · `bg-pane-2` (#e6e5e0, secondary pill, selected row) · `bg-pane-3` (#e1e0db, secondary hover) · `bg-popover` (= page colour, with border) · `bg-primary` dark pill (#26251e) · `bg-wash` 5% ink tint.
- Text: `text-foreground` headings & controls · `text-ink` body (same colour) · `text-muted-foreground` (66%) small grey text · `text-ink-sec` (60%) large grey text (≥18px) · `text-ink-mid` (50%) dates/meta at ≥16px only · `text-link` orange.
- Lines: `border-border`/`border-line` 10% · `border-input` 20% (outline buttons, hovered/focused inputs) · `border-hairline` 2.5% (cards).
- Status: `text-destructive` #cf2d56, `text-success` #1f8a65; tints with `/10`.
- Dark mode is automatic through `.dark` tokens (#14120b, #1b1913, #edecec). Never add `dark:` overrides.

## Type roles (all weight 400; `weight-semibold` = 500, `weight-bold` = 600, use sparingly)
| role | size/line-height/tracking | cursor.com use |
|---|---|---|
| `type-hero` | 72/1.1/−0.03em (compact 52) | closing CTA "Try … now." |
| `type-headline` | 36/1.2/−0.02em (compact 26) | centred section headline, pricing h1 (use hero for that) |
| `type-display` | 26/1.25/−0.0125em (compact 22) | the hero h1, page titles |
| `type-title` | 22/1.3/−0.005em (compact 18) | section and feature headings |
| `type-subtitle` | 16/1.5/0.005em (compact 14) | card titles, body copy on marketing, docs body |
| `type-body` | 14/1.5/0.01em (compact 13) | app body, nav links, footer links, buttons |
| `type-caption` | 12/1.5/0.01em (compact 11) | meta, small labels, nav group labels |
| `type-micro` | 11/1.45 (compact 10) | tiny counters only |
Headings are NOT bold on cursor.com. Remove `weight-semibold` from headings/titles; keep it only for genuinely selected/active items or tiny labels that need it.

## Components
- Buttons (`buttonVariants`): already done. Pills. `default` dark, `secondary` warm grey, `outline` 20% border transparent, `ghost` borderless, `link` orange text with →. Heights: lg 43px (16px text), default 36, sm 28, xs 24. Icon buttons are circles.
- Inputs/textarea/select triggers: 36px tall, `rounded-lg` (8px), `border-border bg-background`, hover/focus `border-input`, focus outline 2px ink offset 0. Placeholder `text-muted-foreground`.
- Menus/popovers/selects/dropdowns/command: `rounded-lg border-border bg-popover shadow-md` (Cursor flyout: two whisper shadows), items 32px tall `rounded-sm` (4px) `px-2`, highlighted item `bg-pane`, `type-body`. Separators `bg-border`.
- Dialog/sheet/drawer: `rounded-lg` (sheet edges square) `border-border bg-background shadow-lg`, overlay `bg-foreground/20` (no blur). Title `type-title`, description `type-body text-muted-foreground`.
- Tooltip: `bg-tooltip text-tooltip-foreground type-caption rounded-sm px-2 py-1`.
- Tabs: segmented pill like the pricing toggle: list `rounded-full bg-pane p-1`, trigger `rounded-full px-4 h-8 type-body text-muted-foreground`, active `bg-background text-foreground shadow-[0_0_0_1px_var(--hairline)]` (or the line variant: underline `border-b-2 border-foreground`).
- Checkbox/radio/switch: checked = `bg-primary` (dark ink), unchecked `border-input bg-background`. Checkbox `rounded-xs` (2px→use `rounded-[4px]` only if needed; prefer `rounded-sm` 4px), switch is a pill.
- Badge: done (`rounded-full`, caption role).
- Kbd: `type-caption h-5 min-w-5 rounded-sm bg-muted-foreground/10 px-1 text-muted-foreground` (Cursor's ⌘K chip), no border, no lip.
- Table: header `type-caption text-muted-foreground`, rows `border-b border-border`, cells `py-2.5 px-3`, hover `bg-pane/60`.
- Sidebar / docs nav (cursor.com/docs): sidebar on the page colour with a `border-r border-border`, width 308px on desktop (or keep the app's width if it must be narrower), group label `type-caption text-muted-foreground` (12px), items 29–32px tall `rounded-sm px-2 type-body` (Cursor 15px; we use 14px body), hover `bg-pane/70`, active item `text-link` (orange) with no fill — or `bg-pane-2 text-foreground` in dense app sidebars where orange would be noisy; pick orange for primary nav.
- App header (docs): 48–49px, `border-b border-border bg-background`, search box 36px `w-80 rounded-lg border-border` with ⌘K chip.
- Separators: `bg-border` 1px.
- Skeleton: `bg-pane rounded-sm`, `animate-pulse` is banned by lint; keep whatever exists.
- Charts: series colours `chart-1` orange, `chart-2` ink, `chart-3` green, `chart-4/5` greys.

## Rules from the repo you must keep
- `bun run lint:typography` currently bans: generic `text-sm/xs/…`, arbitrary `text-[Npx]`, `leading-*`, `tracking-*`, `uppercase`, `font-<weight>`, `rounded-xl` and up, gradients/backdrop-blur, hex in classes, enter animations, `dark:` overrides. Stay within those (they still fit cursor.com). It may also flag `rounded-full`? No — only xl+. 
- No `forwardRef`, named exports, `data-slot` attributes, relative imports inside `packages/ui`.
- Do not touch: `packages/ui/src/styles/theme.css` (owner edits it; tell the owner if you need a token), print previews (`apps/cv/src/components/templates/*`, `apps/invoice/src/components/invoice-preview.tsx`, the portfolio deck slides), PDF files, `routeTree.gen.ts`.
- Do not run `git commit`, do not stage. Do not start or stop dev servers (they are running: hub 4002, cv 4003, invoice 4004, portfolio 4005, design 4006, jobs 4007 with mock api 8790; jobs sign-in: open `http://localhost:4007/?code=mock-sign-in-code` first).
- Verify in a browser with the `agent-browser` CLI only (`agent-browser open …`, `agent-browser screenshot <abs path>`, `agent-browser set viewport 1440 900`, `agent-browser set media light|dark`). Use absolute paths for screenshots, save them under `cook/stills/wip/<your-area>/`.
- When done, run `bun x ultracite fix <your files>` and `bunx tsc --noEmit -p <your package or app>` for the code you touched, and report what you changed and anything left.
