# packages/ui — Shared Component Library (@rulisme/ui)

Reusable React 19 UI primitives published as `@rulisme/ui`, consumed by `apps/home`, `apps/cv`, `apps/invoice`, `apps/portfolio` and `apps/design`, plus the one **Zedative** theme (`DESIGN.md`) every app imports. All 61 shadcn/ui components are here (installed with the shadcn CLI, lyra geometry, radix base, lucide icons) and restyled to Zedative (cursor.com's dark system, `DESIGN.md`).

## Build (important)

- Built with **Vite library mode** (`vite.config.ts`, every `src/**/*.{ts,tsx}` file is an entry, ESM, unminified) plus `tsc --declaration --emitDeclarationOnly` for `.d.ts` → `dist/`.
- `exports` maps `./*` → `./dist/*.js` (types `./dist/*.d.ts`), `./styles/shadcn.css` and `./styles/theme.css` → `src/styles/`. That is the published shape.
- **Inside the workspace every app compiles this package from `src/`**: each app's `tsconfig.json` maps `@rulisme/ui/*` to `../../packages/ui/src/*` and its Vite config sets `resolve.tsconfigPaths: true`, so dev and production builds both bundle the source; each app's `styles.css` `@source`s `packages/ui/src` so Tailwind sees the classes. A component edit shows up in every running app without a library build. `apps/design` reaches the same source through a Vite alias and is the place to work on components.
- `bun run build` (or `bun run dev`, which watches) still emits `dist/` for the package exports; the root `bun run build` runs it first through Turborepo. Declarations come from `tsconfig.build.json`, which leaves test files out.
- `bun run test` (Vitest) covers the design system's own logic: `cn()` merging the `type-*` / `weight-*` groups, `typeClass()`, and `useShortcut`'s guards (typing, combobox triggers, modifiers, repeats, open windows; DOM tests run in happy-dom via `// @vitest-environment happy-dom`). Test files (`*.test.ts(x)`) are excluded from the library build.
- Every bare import is `external` (not bundled); the apps provide the peer deps. Libraries only some components need (`cmdk`, `vaul`, `recharts`, `embla-carousel-react`, `input-otp`, `react-resizable-panels`, `sonner`, `next-themes`, `@shadcn/react`, `react-day-picker`, `@dnd-kit/*`, `react-phone-number-input`) are optional peers: an app installs them only if it imports that component. `@fontsource-variable/geist`, `geist-mono` and `inter` are dependencies (the theme imports them; Inter is the print family).

## Structure & imports

- `src/styles/theme.css` → `@rulisme/ui/styles/theme.css`: every Zedative token in its one dark scheme on `:root` (shadcn roles + `ink`, `ink-sec`, `ink-mid`, `line`, `hairline`, `pane`, `pane-2`, `pane-3`, `link`, `success`, `shot`, `primary-deep`, `wash`, `highlight`, `syn-*`; `.dark` is an alias), the eight `type-*` roles and `weight-*` utilities, radius, elevation (`shadow-md` flyout, `shadow-lg` window), the `band` / `rail` / `surface-card` / `typeset` / `field-touch` utilities (`rail-nodes`, `diamond`, `graph-paper`, `hatch` are retired no-ops), and the base layer (focus, selection, mono code). The only place tokens are defined.
- `src/styles/shadcn.css` → `@rulisme/ui/styles/shadcn.css`: the shadcn runtime variants and utilities (from the CLI, unchanged).
- `src/ui/` — every shadcn component (button, card, dialog, select, sidebar, chart, …) plus `rails` (`Band`, `Rail` = the 1300px container, `Diamond` = renders nothing), `kbd`, the Blocks `spinner` and `not-found` → `@rulisme/ui/ui/button`. `buttonVariants`, `badgeVariants` and `tabsListVariants` live in their own `*-variants.ts` files.
- `src/blocks/` — composites (screen patterns): `page` (PageHeader, PageContent, PageSection, PageGutter), `settings` (SubNavLayout, SettingsCard, SettingsRow, SectionCard), `kanban`, `user-menu`, `app-brand`, `ghost-page`, `window-frame` → `@rulisme/ui/blocks/page`. Data-agnostic: content and copy come in as props, no app hooks, routing or i18n inside; apps keep their behaviour (dnd-kit wiring, sessions) and pass refs, handlers and items.
- `src/form/` — composed form pieces (`form-field`, `month-picker`, `section-list`) → `@rulisme/ui/form/form-field`
- `src/reui/phone-input.tsx` → `@rulisme/ui/reui/phone-input`
- `src/hooks/` — `use-shortcut` (single-letter shortcuts behind `<Kbd>` hints), `use-mobile` (sidebar)
- `src/lib/utils.ts` (`cn()`, phone/URL formatting) → `@rulisme/ui/lib/utils`. `cn()` registers the `type-*` and `weight-*` groups with tailwind-merge; `bun run parity:twmerge` keeps them in sync with `theme.css`.
- `src/lib/iso-date.ts` → local ISO date helpers for the date pickers (`toIsoDate`, `parseIsoDate`, `isoToday`, `addDaysIso`, `startOfMonthIso`, `endOfMonthIso`, `formatIsoDate`); `src/lib/initials.ts` → `initialsOf(name, fallback)` for letter avatars.
- `src/lib/type-scale.ts` → `typeClass(role, variant)`, `TYPE_ROLES`, `TYPE_UTILITIES`, `TYPE_WEIGHTS`.
- `src/print/` → `@rulisme/ui/print/*`: the type of the builders' `@react-pdf` documents (DESIGN.md § Implementation › Print artifacts). `pdf-fonts.ts` takes react-pdf's `Font` (`registerPrintFonts(Font)`, so this package needs no react-pdf dependency) and registers the merged Inter cuts in `fonts/` (latin + latin-ext + vietnamese per weight, OFL in `fonts/OFL.txt`), their glyph-cache repair and the line-break policy (`hyphenateForPrint`, `hyphenateWithin(n)` for a narrow column's Text). `pdf-text.ts` normalises strings for the PDF (`toPrintText`, `toPrintLine`, `toPrintLines`). `print-coverage.ts` and the fonts are generated by `scripts/build-print-fonts.sh` (needs fontTools); never hand-edit them. The library build leaves `print/` out (it would inline the fonts into `dist`); the apps compile it from source like everything else.

## Conventions

- Named exports, PascalCase components, function components, React 19 ref-as-prop. `data-slot` on every part (shadcn pattern). Relative imports inside the package (`../lib/utils`, `./button-variants`); never `@/` or `@rulisme/ui/` from inside it.
- Add a component under the right `src/` subdir; the glob entry picks it up automatically — no barrel/index file. Add it to `apps/design` (`bun run parity:showcase` fails otherwise).
- Style follows `DESIGN.md` and `TYPOGRAPHY.md`: type roles only, tokens only, pill buttons (36px, `sm` 28px, `lg` 43px), 36px fields with 8px corners, 4px cards with a hairline, 8px menus and windows, colour-only transitions at 140ms, no enter/exit animation, no `dark:` overrides. The root style lint covers `src/`.
- Restyle a shared primitive here, once — never fork it in an app.
- Apps render no raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<option>` (lint rule 19, `scripts/check-raw-controls.ts`, TYPOGRAPHY.md § Raw controls): the raw elements live only in this package. A generic piece an app builds twice belongs here (in `blocks/` if it is a screen pattern).
- Menu rows (`SelectItem`, `DropdownMenuItem`, `CommandItem`, `ComboboxItem`, context and menubar items) size a leading lucide icon to 16px in `ink-sec`; `SelectItem` and `DropdownMenuItem` take a trailing `description`.
- Every file in `ui/`, `blocks/`, `form/` and `reui/` is rendered on the design page (`bun run parity:showcase`); composites go in its Patterns section (`apps/design/src/showcase/sections/patterns.tsx`).
- Adding a shadcn component: run `bunx --bun shadcn@latest add <name>` from any app or from here. Every `components.json` (this package and `apps/*`) says `radix-lyra` on the radix base with lucide icons, and the apps' `ui` / `utils` aliases point at `@rulisme/ui`, so the file lands in `src/ui/` here (check with `--dry-run`). Then restyle it to Zedative, rewrite its `@rulisme/ui/...` imports to relative ones (this package's `tsconfig.json` maps the alias so the CLI's output type-checks meanwhile), and render it in `apps/design`.

## Components

Import paths are `@rulisme/ui/<folder>/<file>`. Every shadcn part keeps its
upstream props; the table names what Zedative adds or what to pass.

### Primitives (`ui/`)

| Component | File | What it is | Main props |
| --- | --- | --- | --- |
| Accordion (+Item, Trigger, Content) | `ui/accordion` | Disclosure list | Radix `type`, `collapsible` |
| AlertDialog (+parts, Media) | `ui/alert-dialog` | Confirm window | Radix; `AlertDialogMedia` icon tile |
| Alert (+Title, Description, Action) | `ui/alert` | Inline message | `variant` default / destructive |
| AspectRatio | `ui/aspect-ratio` | Ratio box | `ratio` |
| Attachment (+Group, Media, Content, Title, Description, Actions, Action, Trigger) | `ui/attachment` | File chip / card | composition |
| Avatar (+Image, Fallback, Group, GroupCount, Badge) | `ui/avatar` | Round avatar | `size` xs / sm / default / lg |
| Badge, BadgeButton | `ui/badge`, `ui/badge-variants` | Pill label; removable chip | `variant`; BadgeButton `removeLabel`, `onClick` |
| Breadcrumb (+parts) | `ui/breadcrumb` | Path trail | composition |
| Bubble (+Group, Content, Reactions) | `ui/bubble` | Chat bubble | `align`, `variant` |
| Button, buttonVariants | `ui/button`, `ui/button-variants` | Pill button | `variant` default / outline / secondary / ghost / destructive / link / row, `size` xs / sm / default / lg / icon* , `asChild` |
| ButtonGroup (+Separator, Text) | `ui/button-group` | Joined buttons (split button) | `orientation` |
| Calendar (+DayButton) | `ui/calendar` | Month grid | react-day-picker props |
| Card (+Header, Title, Description, Action, Content, Footer) | `ui/card` | 4px card | `size` |
| Carousel (+Content, Item, Previous, Next) | `ui/carousel` | Embla carousel | `opts`, `orientation` |
| Chart (Container, Tooltip, Legend, Style) | `ui/chart` | Recharts frame | `config` |
| Checkbox | `ui/checkbox` | Check box | Radix |
| Collapsible (+Trigger, Content) | `ui/collapsible` | Show / hide | Radix |
| Combobox (+Input, Content, List, Item, Group, Label, Collection, Empty, Separator, Chips, Chip, ChipsInput, Trigger, Value) | `ui/combobox` | Searchable select, multi-select chips | Base UI `items`, `value`, `onValueChange` |
| Command (+Dialog, Input, List, Empty, Group, Item, Shortcut, Separator) | `ui/command` | ⌘K palette | cmdk |
| ContextMenu (+parts) | `ui/context-menu` | Right-click menu | Radix |
| DatePicker, DateRangePicker | `ui/date-picker` | Field-shaped date / date-time / range picker with presets and clear | `value` ISO, `onValueChange`, `min`, `max`, `presets`, `withTime`, `id`, `size`, `clearable`, `align` |
| Dialog (+parts) | `ui/dialog` | Window | Radix |
| DirectionProvider | `ui/direction` | RTL context | `dir` |
| DragHandle | `ui/drag-handle` | Sortable grip button | `label`, `variant` icon / gutter, dnd-kit attributes |
| Drawer (+parts) | `ui/drawer` | Bottom sheet (vaul) | vaul |
| DropdownMenu (+parts) | `ui/dropdown-menu` | Action menu | Item `variant`, `description`, `inset` |
| EditableTitle | `ui/editable-title` | Inline-editable heading | input props |
| Empty (+Header, Title, Description, Content, Media) | `ui/empty` | Empty state | composition |
| EntityAvatar | `ui/entity-avatar` | Letter avatar for a company or person | `name`, `fallback`, `src`, `size`, `shape` circle / square |
| FieldButton | `ui/field-button` | Button drawn as a field (search / picker trigger) | `size`, `empty` |
| Field (+Label, Description, Error, Group, Legend, Separator, Set, Content, Title) | `ui/field` | Form field layout | `orientation` |
| FileTrigger, FileDropZone | `ui/file-upload` | File pickers (hidden input inside) | `accept`, `multiple`, `onFilesSelect(files)`; drop zone `title`, `description`, `icon` |
| FlagIcon | `ui/flag-icon` | GB / ID flag | `code`, `label` |
| HoverCard (+Trigger, Content) | `ui/hover-card` | Hover preview | Radix |
| Input | `ui/input` | Text field | input props |
| InputGroup (+Addon, Button, Text, Input, Textarea) | `ui/input-group` | Field with addons | `align` |
| InputOTP (+Group, Slot, Separator) | `ui/input-otp` | One-time code | input-otp |
| Item (+Media, Content, Title, Description, Actions, Group, Separator, Header, Footer) | `ui/item` | List row | `variant`, `size`, `asChild` |
| Kbd, KbdGroup | `ui/kbd` | Key chip | — |
| Label | `ui/label` | Field label | Radix |
| Marker (+Icon, Content) | `ui/marker` | Timeline marker | `variant` |
| Menubar (+parts) | `ui/menubar` | App menu bar | Radix |
| Message (+Group, Avatar, Content, Header, Footer), MessageScroller (+parts) | `ui/message`, `ui/message-scroller` | Chat thread | composition |
| Meter | `ui/meter` | Labelled 4px score bar | `value`, `max`, `tone` auto / success / link / neutral / destructive, `high`, `mid`, `label`, `valueLabel` |
| NativeSelect (+Option, OptGroup) | `ui/native-select` | Native select | `size` |
| NavigationMenu (+parts) | `ui/navigation-menu` | Site nav | Radix |
| NotFound | `ui/not-found` | 404 page | copy props |
| Pagination (+parts) | `ui/pagination` | Pager | composition |
| Popover (+Anchor, Content, Header, Title, Description) | `ui/popover` | Flyout panel | Radix |
| Progress | `ui/progress` | Loading bar | `value` |
| PropertyChip | `ui/property-chip` | 28px fact chip with icon | `icon`, children |
| Questionnaire (+parts) | `ui/questionnaire` | Step-by-step form | composition |
| RadioGroup (+Item) | `ui/radio-group` | Radios | Radix |
| Band, Rail, Diamond | `ui/rails` | Layout container (Diamond renders nothing) | — |
| ResizablePanelGroup (+Panel, Handle) | `ui/resizable` | Split panes | react-resizable-panels |
| ScrollArea, ScrollBar | `ui/scroll-area` | Styled scroll | Radix |
| SegmentedControl (+Item) | `ui/segmented-control` | Single-choice pill track | `value`, `onValueChange`, `size`; items `value`, icon child |
| Select (+parts) | `ui/select` | Fixed-list select | Item `description`; icon / StatusDot first child |
| Separator | `ui/separator` | Rule | `orientation` |
| Sheet (+parts) | `ui/sheet` | Side panel | `side` |
| Sidebar (+parts, useSidebar) | `ui/sidebar` | App sidebar | `collapsible`, `variant` |
| Skeleton | `ui/skeleton` | Placeholder | — |
| Slider | `ui/slider` | Range slider | Radix |
| Toaster | `ui/sonner` | Toasts | sonner |
| Spinner | `ui/spinner` | Blocks spinner | size via `--spinner-size` |
| StatCard, StatGrid, DeltaChip | `ui/stat-card` | KPI card, its grid, the delta chip | `label`, `value`, `delta {direction, label}`, `footer` |
| StatusDot | `ui/status-dot` | 8px status dot | `tone` neutral / link / warning / success / destructive / ink, `pulse` |
| SwatchPicker | `ui/swatch-picker` | Colour swatches (document colours) | `colors`, `value`, `onValueChange`, `allowCustom` |
| Switch | `ui/switch` | Toggle switch | `size` |
| Table (+parts) | `ui/table` | Data table | composition |
| Tabs (+List, Trigger, Content), tab variants | `ui/tabs`, `ui/tabs-variants` | Tabs | List `variant` default / line |
| Textarea | `ui/textarea` | Multi-line field | textarea props |
| Toggle, ToggleGroup (+Item) | `ui/toggle`, `ui/toggle-group` | Pressed buttons | `variant`, `size`, `spacing` |
| Tooltip (+Provider, Trigger, Content) | `ui/tooltip` | Tooltip | Radix |

### Composites (`blocks/`)

| Component | File | What it is | Main props |
| --- | --- | --- | --- |
| PageHeader, PageContent, PageSection, PageGutter, PAGE_GUTTER, PAGE_COLUMN | `blocks/page` | App screen frame | `title`, `description`, `count`, `actions`, `wide` |
| SubNavLayout, SettingsCard, SettingsRow, SectionCard | `blocks/settings` | Settings page with sub-nav, cards of label / control rows, titled cards | `items`, `value`, `onChange`; card `title`, `description`, `action`, `footer`, `tone`, `inset`; row `label`, `description`, `htmlFor`, `icon`, `badge`, `align` |
| Kanban, KanbanColumn, KanbanColumnHeader, KanbanColumnContent, KanbanColumnEmpty, KanbanCard, KanbanCollapsedColumn | `blocks/kanban` | Render-only board (the app wires drag and drop) | header `icon`, `title`, `titleId`, `count`, `countLabel`, `actions`; content `state` idle / over / blocked, `ref`; card `selected`, `pending`, `muted`, `dashed`; collapsed `expandLabel`, `onExpand` |
| UserMenu | `blocks/user-menu` | Sidebar account row + menu | `name`, `email`, `label`, `collapsed`, children = menu items |
| AppBrand | `blocks/app-brand` | Mark + name in a toolbar | `name`, `src` |
| GhostPage | `blocks/ghost-page` | Empty A4 sheet | `title`, `description`, `orientation` |
| WindowFrame | `blocks/window-frame` | Desktop window for product shots | `title`, children |

### Form pieces and ports

| Component | File | What it is | Main props |
| --- | --- | --- | --- |
| FormField, FormFieldCustom | `form/form-field` | Labelled field with error and counter | `label`, `value`, `onChange`, `multiline`, `error` |
| MonthPicker | `form/month-picker` | Month + year selects | `value`, `onChange` |
| SectionList | `form/section-list` | Sortable accordion list of entries with an editable title | `items`, `render`, `summary`, `onTitleChange` |
| PhoneInput | `reui/phone-input` | Country + number field | `value`, `onChange`, `defaultCountry`, `variant` |

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
