import { cn } from "@rulisme/ui/lib/utils";
import type { TypeRole } from "@rulisme/ui/lib/type-scale";
import { TYPE_ROLES, typeClass } from "@rulisme/ui/lib/type-scale";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Band, Rail } from "@rulisme/ui/ui/rails";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  FileText,
  GitBranch,
  Search,
} from "lucide-react";
import { ColorPair, Swatch } from "../color-pair";
import { Block, BlockGrid, Example, Section } from "../layout";

const ROLE_PAIRS = [
  { name: "Page", background: "background", foreground: "foreground" },
  {
    name: "Body copy on the page",
    background: "background",
    foreground: "ink",
  },
  { name: "Card", background: "card", foreground: "card-foreground" },
  { name: "Popover", background: "popover", foreground: "popover-foreground" },
  {
    name: "Primary pill",
    background: "primary",
    foreground: "primary-foreground",
  },
  {
    name: "Secondary pill",
    background: "secondary",
    foreground: "secondary-foreground",
  },
  {
    name: "Small grey text (60%)",
    background: "background",
    foreground: "muted-foreground",
  },
  {
    name: "Large grey text (ink-sec)",
    background: "background",
    foreground: "ink-sec",
  },
  {
    name: "Meta at 16px+ (ink-mid)",
    background: "background",
    foreground: "ink-mid",
  },
  {
    name: "Selected row (pane-2)",
    background: "pane-2",
    foreground: "foreground",
  },
  { name: "Text link", background: "background", foreground: "link" },
  {
    name: "Destructive on the page",
    background: "background",
    foreground: "destructive",
  },
  {
    name: "Success on the page",
    background: "background",
    foreground: "success",
  },
  { name: "Tooltip", background: "tooltip", foreground: "tooltip-foreground" },
] as const;

const PALETTE = [
  {
    group: "Surfaces",
    swatches: [
      { name: "page", token: "background" },
      { name: "card", token: "card" },
      { name: "pane (hover, chips)", token: "pane" },
      { name: "pane-2 (secondary, selected)", token: "pane-2" },
      { name: "pane-3 (secondary hover)", token: "pane-3" },
      { name: "popover", token: "popover" },
      { name: "shot (screenshot slot)", token: "shot" },
      { name: "wash 5%", token: "wash" },
    ],
  },
  {
    group: "Ink",
    swatches: [
      { name: "foreground", token: "foreground" },
      { name: "ink (running text)", token: "ink" },
      { name: "ink-sec 60% (≥18px)", token: "ink-sec" },
      { name: "muted 60% (small)", token: "muted-foreground" },
      { name: "ink-mid 50% (meta)", token: "ink-mid" },
      { name: "offgray 40% (decor)", token: "offgray" },
    ],
  },
  {
    group: "Pills",
    swatches: [
      { name: "primary", token: "primary" },
      { name: "primary hover", token: "primary-deep" },
      { name: "on primary", token: "primary-foreground" },
      { name: "secondary", token: "secondary" },
    ],
  },
  {
    group: "Link and status",
    swatches: [
      { name: "link (orange)", token: "link" },
      { name: "highlight 15%", token: "highlight" },
      { name: "destructive", token: "destructive" },
      { name: "success", token: "success" },
    ],
  },
  {
    group: "Lines and focus",
    swatches: [
      { name: "border / line 10%", token: "border" },
      { name: "hairline 2.5% (cards)", token: "hairline" },
      { name: "input 20%", token: "input" },
      { name: "ring", token: "ring" },
    ],
  },
  {
    group: "Charts",
    swatches: [1, 2, 3, 4, 5].map((n) => ({
      name: `chart-${n}`,
      token: `chart-${n}`,
    })),
  },
  {
    group: "Sidebar",
    swatches: [
      { name: "sidebar (card colour)", token: "sidebar" },
      { name: "sidebar-accent", token: "sidebar-accent" },
      { name: "sidebar-border", token: "sidebar-border" },
      { name: "sidebar-primary", token: "sidebar-primary" },
    ],
  },
  {
    group: "Syntax (editor mock only)",
    swatches: [
      { name: "syn-1 types", token: "syn-1" },
      { name: "syn-2 strings", token: "syn-2" },
      { name: "syn-3 numbers", token: "syn-3" },
      { name: "syn-4 keywords", token: "syn-4" },
    ],
  },
] as const;

const TYPE_SPECS: Record<
  TypeRole,
  { spec: string; compact: string; use: string; sample: string }
> = {
  hero: {
    spec: "72/79 · 400 · −0.03em",
    compact: "52/60",
    use: "The closing call to action on a landing page",
    sample: "Start your CV now.",
  },
  headline: {
    spec: "36/43 · 400 · −0.02em",
    compact: "26/33",
    use: "A centred section headline on a landing page",
    sample: "Write it, see it, download it.",
  },
  display: {
    spec: "26/33 · 400 · −0.0125em",
    compact: "22/29",
    use: "The hero h1, page titles",
    sample: "Pilih Pendidikan builds your CV in your browser.",
  },
  title: {
    spec: "22/29 · 400 · −0.005em",
    compact: "18/25",
    use: "Section and feature headings, dialog titles",
    sample: "Work experience",
  },
  subtitle: {
    spec: "16/24 · 400 · 0.005em",
    compact: "14/21",
    use: "Card titles, marketing body copy, leads",
    sample: "A CV that reads at a glance, on paper and on screen",
  },
  body: {
    spec: "14/21 · 400 · 0.01em",
    compact: "13/19.5",
    use: "App body copy, control labels, nav and menu rows",
    sample: "Add the roles you held, newest first, with one line on impact.",
  },
  caption: {
    spec: "12/18 · 400 · 0.01em",
    compact: "11/16.5",
    use: "Descriptions, meta, errors, group labels, tooltips",
    sample: "Saved to the cloud 2 minutes ago",
  },
  micro: {
    spec: "11/16 · 400",
    compact: "10/14",
    use: "Counters and tiny badges; single line",
    sample: "3 of 5 projects",
  },
};

const WEIGHTS = [
  { utility: "weight-normal", value: "400", use: "Everything: headings too" },
  {
    utility: "weight-semibold",
    value: "500",
    use: "A selected item or a tiny label that needs it",
  },
  {
    utility: "weight-bold",
    value: "600",
    use: "Rarely; never for headings",
  },
] as const;

const SPACING = [
  { px: 4, className: "w-1", use: "Icon to label" },
  { px: 8, className: "w-2", use: "Inside a component, card gaps" },
  { px: 12, className: "w-3", use: "Between related controls" },
  { px: 16, className: "w-4", use: "Field rows, small card padding" },
  { px: 24, className: "w-6", use: "Between groups" },
  { px: 32, className: "w-8", use: "Between cards" },
  { px: 48, className: "w-12", use: "Between blocks" },
  { px: 96, className: "w-24", use: "Section rhythm, hero" },
] as const;

const RADII = [
  {
    className: "rounded-xs",
    label: "xs · 2px",
    use: "Tiny chips",
  },
  {
    className: "rounded-sm",
    label: "sm · 4px",
    use: "Cards, rows, menu items, kbd, tooltips",
  },
  {
    className: "rounded-lg",
    label: "lg · 8px",
    use: "Fields, menus, popovers, dialogs",
  },
  {
    className: "rounded-full",
    label: "full",
    use: "Buttons, badges, tabs, switches, avatars",
  },
] as const;

const ELEVATION = [
  {
    name: "Page",
    className: "bg-background border border-border",
    use: "#14120b, flat",
  },
  {
    name: "Card",
    className: "rounded-sm border border-hairline bg-card",
    use: "One step up, 2.5% hairline, no shadow",
  },
  {
    name: "Flyout",
    className: "rounded-lg border border-border bg-popover shadow-md",
    use: "Menus, popovers, selects: two whisper shadows",
  },
  {
    name: "Window",
    className: "rounded-lg border border-border bg-popover shadow-lg",
    use: "Dialogs, sheets, toasts: the one soft drop",
  },
] as const;

function SpecimenTable() {
  return (
    <div className="overflow-x-auto rounded-sm border border-hairline bg-card">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-border border-b">
            {["Role", "Default", "Compact", "Use", "Specimen"].map(
              (heading) => (
                <th
                  className="type-caption px-3 py-2 text-muted-foreground"
                  key={heading}
                  scope="col"
                >
                  {heading}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {TYPE_ROLES.map((role) => {
            const spec = TYPE_SPECS[role];
            return (
              <tr className="border-border border-b last:border-b-0" key={role}>
                <th
                  className="type-caption whitespace-nowrap px-3 py-3 align-top text-foreground"
                  scope="row"
                >
                  type-{role}
                </th>
                <td className="type-caption whitespace-nowrap px-3 py-3 align-top text-muted-foreground tabular-nums">
                  {spec.spec}
                </td>
                <td className="type-caption whitespace-nowrap px-3 py-3 align-top text-muted-foreground tabular-nums">
                  {spec.compact}
                </td>
                <td className="type-caption px-3 py-3 align-top text-muted-foreground">
                  {spec.use}
                </td>
                <td className="max-w-80 px-3 py-3 align-top">
                  <p
                    className={cn("truncate text-foreground", typeClass(role))}
                  >
                    {spec.sample}
                  </p>
                  <p
                    className={cn(
                      "truncate text-muted-foreground",
                      typeClass(role, "compact")
                    )}
                  >
                    {spec.sample}
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Elevation() {
  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
      {ELEVATION.map((level) => (
        <div className="flex flex-col gap-2" key={level.name}>
          <div
            className={cn(
              "type-caption grid h-24 place-items-center text-muted-foreground",
              level.className
            )}
          >
            {level.name}
          </div>
          <p className="type-caption text-muted-foreground">{level.use}</p>
        </div>
      ))}
    </div>
  );
}

/** Band and Rail drawn to scale: the full-bleed section and the container. */
function LayoutDiagram() {
  return (
    <div className="flex flex-col gap-2 overflow-hidden rounded-sm border border-hairline bg-background py-4">
      <Band className="bg-pane/50">
        <Rail className="type-caption flex h-16 items-center justify-center rounded-sm border border-border border-dashed text-muted-foreground">
          Rail · the 1300px container, 20px clear of the edge
        </Rail>
      </Band>
      <Band className="bg-pane/50">
        <Rail className="type-caption flex h-10 items-center justify-center rounded-sm border border-border border-dashed text-muted-foreground">
          Next band · sections are separated by space, not rules
        </Rail>
      </Band>
    </div>
  );
}

export function FoundationsSection() {
  return (
    <Section
      id="foundations"
      lead="Colour as roles with measured contrast, the palette from theme.css, Geist in eight roles at weight 400, the 4px spacing scale, radius, elevation, motion and layout."
      title="Foundations"
    >
      <BlockGrid>
        <Block
          description="Each surface with its foreground and the contrast measured live. There is one scheme: cursor.com's dark theme."
          title="Colour roles"
          wide
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_PAIRS.map((pair) => (
              <ColorPair
                background={pair.background}
                foreground={pair.foreground}
                key={pair.name}
                name={pair.name}
              />
            ))}
          </div>
        </Block>

        <Block
          description="Every token in theme.css, resolved over the page. The page is warm near-black, cards one step lighter; grey text is ink at 50–60%. Orange is the one saturated colour outside code, and it only marks text links."
          title="Palette"
          wide
        >
          <div className="flex flex-col gap-8">
            {PALETTE.map((group) => (
              <div className="flex flex-col gap-3" key={group.group}>
                <h4 className="type-caption text-muted-foreground">
                  {group.group}
                </h4>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {group.swatches.map((swatch) => (
                    <Swatch
                      key={swatch.token}
                      name={swatch.name}
                      token={swatch.token}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Block>

        <Block
          description="Geist Variable for everything on screen (Geist Mono for code), on cursor.com's scale: eight roles at a default and a compact step, all weight 400. Pick by purpose, not by pixel size. Print artifacts keep Inter to match their PDFs."
          title="Type roles"
          wide
        >
          <SpecimenTable />
        </Block>

        <Block
          description="Headings are not bold: hierarchy comes from size. 500 marks a selected item; 600 is the rare exception."
          title="Weights"
        >
          <Example stack>
            {WEIGHTS.map((weight) => (
              <div
                className="flex items-baseline justify-between gap-4"
                key={weight.utility}
              >
                <span
                  className={cn(
                    "type-subtitle text-foreground",
                    weight.utility
                  )}
                >
                  Selected item
                </span>
                <span className="type-caption text-right text-muted-foreground tabular-nums">
                  {weight.utility} · {weight.value} · {weight.use}
                </span>
              </div>
            ))}
          </Example>
        </Block>

        <Block
          description="Running text inherits ink; headings and controls are foreground. Links are orange with no underline; commands sit in a kbd."
          title="Running text"
        >
          <Example stack>
            <h4 className="type-title">Share a read-only link</h4>
            <p className="type-body max-w-prose">
              Every saved CV gets a public link you can send to a recruiter.
              Open the{" "}
              <a
                className="text-link transition-[color] duration-140 ease-standard hover:text-link/75"
                href="#overlays"
              >
                share dialog
              </a>{" "}
              from the toolbar, or press <Kbd>S</Kbd> anywhere outside a field.
              The link always shows your latest saved version, never a draft.
            </p>
            <a
              className="type-body text-link transition-[color] duration-140 ease-standard hover:text-link/75"
              href="#overlays"
            >
              Learn more →
            </a>
            <p className="type-caption text-muted-foreground">
              Descriptions, meta and helper text drop to caption in 60% ink.
            </p>
          </Example>
        </Block>

        <Block
          description="A 4px base unit. The scale steps 4 / 8 / 12 / 16 / 24 / 32 / 48 / 96; cards pad 17.5px (15px when small)."
          title="Spacing"
        >
          <Example stack>
            {SPACING.map((step) => (
              <div
                className="grid grid-cols-[3rem_6rem_1fr] items-center gap-3"
                key={step.px}
              >
                <span className="type-caption text-muted-foreground tabular-nums">
                  {step.px}px
                </span>
                {/* Measurements are decoration, so offgray: orange stays
                    for links. */}
                <span
                  className={cn("h-3 rounded-xs bg-offgray", step.className)}
                />
                <span className="type-caption text-muted-foreground">
                  {step.use}
                </span>
              </div>
            ))}
          </Example>
        </Block>

        <Block
          description="Cards and rows take 4px, fields and windows 8px, and everything you press is a pill."
          title="Radius"
        >
          <Example>
            {RADII.map((radius) => (
              <div className="flex w-28 flex-col gap-2" key={radius.label}>
                <div
                  className={cn(
                    "size-14 border border-input bg-pane",
                    radius.className
                  )}
                />
                <span className="type-caption text-foreground">
                  {radius.label}
                </span>
                <span className="type-micro text-muted-foreground">
                  {radius.use}
                </span>
              </div>
            ))}
          </Example>
        </Block>

        <Block
          description="Flat. Cards are one step lighter on a 2.5% hairline; flyouts get Cursor's two whisper shadows, windows one soft drop. Never a shadow on a card, never a glow."
          title="Elevation"
          wide
        >
          <Elevation />
        </Block>

        <Block
          description="140ms on cubic-bezier(0.4, 0, 0.2, 1), and only colours move: fills, borders and text. Nothing presses down, nothing slides in, overlays open instantly."
          title="Motion"
        >
          <Example>
            <Button>
              <Download aria-hidden="true" data-icon="inline-start" />
              Hover me
            </Button>
            <Button variant="secondary">Secondary</Button>
            <span className="type-caption flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="pulse-dot size-2 rounded-full bg-success"
              />
              Live status pulse
            </span>
            <p className="type-caption w-full text-muted-foreground">
              The pill's fill changes colour on hover; on click it stays put.
              The pulse runs only without reduced motion.
            </p>
          </Example>
        </Block>

        <Block
          description="lucide, outlined, at 12, 14 and 16px. Buttons size their own icons."
          title="Icons"
        >
          <Example stack>
            {(["size-3", "size-3.5", "size-4"] as const).map((size) => (
              <div className="flex items-center gap-4" key={size}>
                <span className="type-caption w-16 text-muted-foreground">
                  {size}
                </span>
                {[
                  FileText,
                  Download,
                  GitBranch,
                  Search,
                  Check,
                  ChevronRight,
                  ArrowUpRight,
                ].map((Icon) => (
                  <Icon
                    aria-hidden="true"
                    className={cn(size, "text-foreground")}
                    key={Icon.displayName ?? Icon.name}
                  />
                ))}
                {[FileText, Search].map((Icon) => (
                  <Icon
                    aria-hidden="true"
                    className={cn(size, "text-muted-foreground")}
                    key={`muted-${Icon.displayName ?? Icon.name}`}
                  />
                ))}
              </div>
            ))}
          </Example>
        </Block>

        <Block
          description="A Band is a full-bleed section with no border; a Rail is Cursor's 1300px container with 20px gutters. App pages add a 49px header and a docs nav on the card colour, like this one."
          title="Layout"
          wide
        >
          <LayoutDiagram />
        </Block>
      </BlockGrid>
    </Section>
  );
}
