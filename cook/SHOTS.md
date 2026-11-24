# Shots

Dark only since 2026-11-24: every shot renders with `set media dark` and compares against the `*-dark-*` refs (S03 and S08 are folded into S02 and S05).

Every shot is one screen at a fixed viewport, rendered by `cook/harness/stills.sh` (agent-browser, `set media`, full page unless noted).

| Shot | Ref | Ours | Viewport | Take from it | Watch for |
|---|---|---|---|---|---|
| S01 | R01 home light, fold | hub `/` (4002) fold | 1440×900 light | header (52px, 14px links, pill Sign in / ghost / dark Download), hero h1 26/32.5 at x=70 y=164, pill buttons 43px | container 1300px, x=70 |
| S02 | R01 home light, full | hub `/` full | 1440 light | section rhythm (section padding 67.2px 20px), cards #f2f1ed r4 p17.5, feature cards text left 383px, logo-strip tiles, headline section 36px, card grids gap 10px, 72px CTA, footer #f2f1ed 5 cols | grey ratio, orange links |
| S03 | R01 home dark | hub `/` dark | 1440 dark | #14120b / #1b1913 / #edecec | warm not neutral |
| S04 | R01 home 390 | hub `/` | 390×844 light | mobile header, stacked cards, 20px gutters | no h-scroll |
| S05 | R04 docs light | jobs dashboard `/board` + `/settings` | 1440×900 | app chrome: top bar 48px, left sidebar 308px w/ right hairline, 16px nav items, section labels in text-sec, 4px cards | density |
| S06 | R04 docs light | cv builder `/` | 1440×900 | toolbar, form fields, cards, buttons | preview sheet untouched |
| S07 | R02 pricing light | design page `/` (4006) | 1440 | buttons (dark pill, secondary #e6e5e0, ghost 20% border), segmented control, cards, badges (orange 10% pill) | every component |
| S08 | R04 docs dark | jobs dashboard dark | 1440 dark | dark app chrome | |
| S09 | R02 pricing | invoice + portfolio builders | 1440 | builder chrome consistent with S06 | |

## Job Tracker (round 3+, user request 2026-11-24: reui.io blocks as the reference)

| Shot | Ref | Ours | Viewport | Take from it |
|---|---|---|---|---|
| S05a | `refs/reui/kanban-board-2.png`, `solution-crm-2.png` | `/board` (kanban) | 1440×900 | lanes, column headers with status dot + count, dense cards with avatar, progress, footer |
| S05b | `refs/reui/settings-2.png`, `profile-1.png` | `/settings` | 1440×900 | sub-nav + toggle rows card |
| S10 | `refs/reui/list-1.png` | `/board?view=list` | 1440×900 | grouped rows |
| S11 | `refs/reui/solution-crm-1.png`, `data-grid-base-1.png` | `/board?view=table` | 1440×900 | sortable table, selection |
| S12 | `refs/reui/sheet-1.png` | details sheet (agent screenshots) | 1440×900 | header, property chips, sections, footer |
| S13 | `refs/reui/profile-1.png` | `/profile` | 1440×900 | account-settings rows |
| S14 | `refs/reui/stats-1.png`, `solution-crm-1.png` | `/stats` | 1440×900 | 4 stat cards, chart cards |
| S15 | `refs/reui/app-shell-2.png` | `/board` | 390×844 | mobile shell |
| — | `refs/reui/app-shell-1-menu.png` | profile dropdown (agent screenshots) | 1440×900 | header, items, sign out |
