import { cn } from "@rulisme/ui/lib/utils";
import type { TypeRole } from "@rulisme/ui/lib/type-scale";
import { TYPE_ROLES, typeClass } from "@rulisme/ui/lib/type-scale";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Diamond } from "@rulisme/ui/ui/rails";
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
  { name: "Paper", background: "background", foreground: "foreground" },
  { name: "Body copy on paper", background: "background", foreground: "ink" },
  { name: "Card (bg-2)", background: "card", foreground: "card-foreground" },
  { name: "Popover", background: "popover", foreground: "popover-foreground" },
  { name: "Primary", background: "primary", foreground: "primary-foreground" },
  {
    name: "Secondary",
    background: "secondary",
    foreground: "secondary-foreground",
  },
  { name: "Muted (pane)", background: "muted", foreground: "muted-foreground" },
  {
    name: "Accent (hover wash)",
    background: "accent",
    foreground: "accent-foreground",
  },
  {
    name: "Active row (pane-2)",
    background: "pane-2",
    foreground: "muted-foreground",
  },
  {
    name: "Destructive on paper",
    background: "background",
    foreground: "destructive",
  },
  { name: "Link on paper", background: "background", foreground: "primary" },
  { name: "Tooltip", background: "tooltip", foreground: "tooltip-foreground" },
] as const;

const PALETTE = [
  {
    group: "Paper",
    swatches: [
      { name: "bg", token: "background" },
      { name: "bg-2", token: "card" },
      { name: "pane", token: "pane" },
      { name: "pane-2", token: "pane-2" },
      { name: "shot", token: "shot" },
    ],
  },
  {
    group: "Ink",
    swatches: [
      { name: "fg", token: "foreground" },
      { name: "ink", token: "ink" },
      { name: "fg-muted", token: "muted-foreground" },
      { name: "offgray (decor)", token: "offgray" },
    ],
  },
  {
    group: "Accent",
    swatches: [
      { name: "accent", token: "primary" },
      { name: "accent-deep", token: "primary-deep" },
      { name: "wash 7%", token: "wash" },
      { name: "highlight 15%", token: "highlight" },
    ],
  },
  {
    group: "Lines and focus",
    swatches: [
      { name: "border", token: "border" },
      { name: "line", token: "line" },
      { name: "input", token: "input" },
      { name: "ring", token: "ring" },
    ],
  },
  {
    group: "Status",
    swatches: [
      { name: "destructive", token: "destructive" },
      { name: "on destructive", token: "destructive-foreground" },
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
      { name: "sidebar", token: "sidebar" },
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
  display: {
    spec: "28/34 · 700 · opsz 25",
    compact: "24/30",
    use: "The page title (hero h1) only",
    sample: "Drafting paper for documents that open doors",
  },
  title: {
    spec: "16/22 · 550 · opsz 18",
    compact: "15/20",
    use: "Section headings, dialog and sheet titles",
    sample: "Work experience",
  },
  subtitle: {
    spec: "14/20 · 400 · opsz 14",
    compact: "13/18",
    use: "Card titles, leads, quotes, chat bubbles",
    sample: "A CV that reads at a glance, on paper and on screen",
  },
  body: {
    spec: "13/20 · 400 · opsz 14",
    compact: "12/18",
    use: "Body copy, control labels, menu rows",
    sample: "Add the roles you held, newest first, with one line on impact.",
  },
  caption: {
    spec: "12/16 · 400 · opsz 14",
    compact: "11/14",
    use: "Descriptions, meta, errors, group labels, tooltips",
    sample: "Saved to the cloud 2 minutes ago",
  },
  micro: {
    spec: "11/14 · 400 · opsz 14",
    compact: "10/12",
    use: "Kbd caps, counters, tiny badges; single line",
    sample: "3 of 5 projects",
  },
};

const WEIGHTS = [
  { utility: "weight-normal", value: "400 · opsz 14", use: "Text" },
  {
    utility: "weight-semibold",
    value: "550 · opsz 18",
    use: "Headings, names, selected items",
  },
  {
    utility: "weight-bold",
    value: "700 · opsz 25",
    use: "The display role only",
  },
] as const;

const SPACING = [
  { px: 4, className: "w-1", use: "Icon to label" },
  { px: 8, className: "w-2", use: "Inside a component" },
  { px: 12, className: "w-3", use: "Between related controls" },
  { px: 16, className: "w-4", use: "Field rows" },
  { px: 24, className: "w-6", use: "Between groups" },
  { px: 32, className: "w-8", use: "Between cards" },
  { px: 48, className: "w-12", use: "Section padding" },
  { px: 96, className: "w-24", use: "Section rhythm, hero" },
] as const;

const RADII = [
  {
    className: "rounded-none",
    label: "none · 0",
    use: "Cards, sections, bands, tables, sheets",
  },
  {
    className: "rounded-sm",
    label: "sm · 2px",
    use: "Kbd, badges, chips, tiles, avatars",
  },
  {
    className: "rounded-md",
    label: "md · 4px",
    use: "Buttons, nav links, fields",
  },
  {
    className: "rounded-lg",
    label: "lg · 6px",
    use: "Windows: dialogs, menus, popovers",
  },
  {
    className: "rounded-full",
    label: "full",
    use: "Status dots, radios, traffic lights",
  },
] as const;

const KNOBS = [
  { token: "--grid", value: "16px", use: "Graph-paper pitch (6–40px)" },
  {
    token: "--grid-ink",
    value: "6%",
    use: "Graph-paper strength (0–20% of offgray)",
  },
  { token: "--node", value: "7px", use: "Diamond size (0 hides them)" },
  { token: "--rail", value: "112px", use: "Offset of the outer faint rules" },
  { token: "--grain", value: "0.06", use: "Paper-noise opacity" },
] as const;

function SpecimenTable() {
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-line border-b bg-pane/50">
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
              <tr className="border-line border-b last:border-b-0" key={role}>
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
                    className={cn(
                      "truncate text-foreground",
                      typeClass(role),
                      role === "display" && "text-primary italic"
                    )}
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
      <div className="flex flex-col gap-2">
        <div className="type-caption grid h-24 place-items-center border border-border bg-card text-muted-foreground">
          Flat
        </div>
        <p className="type-caption text-muted-foreground">
          Page, bands, cards, tables
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="type-caption inset-shadow-lip grid h-24 place-items-center rounded-sm border border-border/60 bg-card/60 text-muted-foreground">
          Lip
        </div>
        <p className="type-caption text-muted-foreground">
          Buttons, tiles; gone on hover
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="graph-paper type-caption grid h-24 place-items-center border border-border bg-card text-muted-foreground shadow-offset">
          Offset
        </div>
        <p className="type-caption text-muted-foreground">Highlighted cards</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="type-caption grid h-24 place-items-center rounded-lg border border-border bg-popover text-muted-foreground shadow-float">
          Float
        </div>
        <p className="type-caption text-muted-foreground">
          Dialogs, menus, the editor window
        </p>
      </div>
    </div>
  );
}

function RailDiagram() {
  return (
    <div className="graph-paper overflow-hidden border border-line">
      <div className="band h-6" />
      <div className="band">
        <div className="rail rail-nodes type-caption flex h-20 items-center justify-center bg-background text-muted-foreground">
          Ruled 1120px column
        </div>
      </div>
      <div className="band">
        <div className="rail rail-nodes type-caption flex h-12 items-center justify-center bg-background text-muted-foreground">
          Next band
        </div>
      </div>
      <div className="h-6" />
    </div>
  );
}

export function FoundationsSection() {
  return (
    <Section
      id="foundations"
      lead="Colour as roles with measured contrast, then the palette, one family in six roles, the 4px spacing scale, radius, elevation, motion and the drafting frame."
      title="Foundations"
    >
      <BlockGrid>
        <Block
          description="Each surface with its foreground and the contrast measured in the current scheme. Toggle Night Desk (T) to re-measure."
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
          description="Grouped as the DESIGN.md groups them. The blue is the only saturated colour outside code; syntax colours stay in the editor mock."
          title="Palette"
          wide
        >
          <div className="flex flex-col gap-8">
            {PALETTE.map((group) => (
              <div className="flex flex-col gap-3" key={group.group}>
                <h4 className="type-caption text-muted-foreground">
                  {group.group}
                </h4>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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
          description="Inter Variable 4.0 for everything. Six roles at a default and a compact step; pick by purpose, not by pixel size."
          title="Type roles"
          wide
        >
          <SpecimenTable />
        </Block>

        <Block
          description="Each weight is paired with an optical size so a label keeps its width when it gets heavier."
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
                <span className="type-caption text-muted-foreground tabular-nums">
                  {weight.utility} · {weight.value}
                </span>
              </div>
            ))}
          </Example>
        </Block>

        <Block
          description="Running text inherits ink; headings and controls are black. Links are cobalt; commands sit in a kbd."
          title="Running text"
        >
          <Example stack>
            <h4 className="type-title">Share a read-only link</h4>
            <p className="type-body max-w-prose">
              Every saved CV gets a public link you can send to a recruiter.
              Open the{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="#overlays"
              >
                share dialog
              </a>{" "}
              from the toolbar, or press <Kbd>S</Kbd> anywhere outside a field.
              The link always shows your latest saved version, never a draft.
            </p>
            <p className="type-caption text-muted-foreground">
              Descriptions, meta and helper text drop to caption in muted ink.
            </p>
          </Example>
        </Block>

        <Block
          description="A 4px base unit. The scale steps 4 / 8 / 12 / 16 / 24 / 32 / 48 / 96."
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
                {/* Measurements are drafting marks, so offgray: the blue
                    stays for actions (at most two cobalt places in view). */}
                <span className={cn("h-3 bg-offgray", step.className)} />
                <span className="type-caption text-muted-foreground">
                  {step.use}
                </span>
              </div>
            ))}
          </Example>
        </Block>

        <Block
          description="Only buttons and small chips round their corners; windows take 6px; cards and sections are square."
          title="Radius"
        >
          <Example>
            {RADII.map((radius) => (
              <div className="flex w-28 flex-col gap-2" key={radius.label}>
                <div
                  className={cn(
                    "size-14 border border-offgray/50 bg-card",
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
          description="Flat drafting paper. An inset lip on pressables, a flat cobalt offset on highlighted cards, one soft drop under floating windows. Never a shadow on an ordinary card."
          title="Elevation"
          wide
        >
          <Elevation />
        </Block>

        <Block
          description="150ms on cubic-bezier(0.4, 0, 0.2, 1). Backgrounds, lips, hover fills, underline colour and link opacity move; layout, sections and overlays never do."
          title="Motion"
        >
          <Example>
            <Button>
              <Download aria-hidden="true" data-icon="inline-start" />
              Press and hold
            </Button>
            <span className="type-caption flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="pulse-dot size-2 rounded-full bg-primary"
              />
              Live status pulse
            </span>
            <p className="type-caption w-full text-muted-foreground">
              The press offsets 1px down and scales to 0.99, instantly. The
              pulse runs only without reduced motion.
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
          description="Every section is a band with a 1px bottom rule; the ruled column carries a diamond where its rules meet the one above. Graph paper and grain stay barely visible."
          title="Rails, nodes and paper"
        >
          <RailDiagram />
          <div className="relative h-10 border-line border-t">
            <Diamond className="-top-1 left-1/2" />
            <span className="type-caption absolute top-3 left-0 text-muted-foreground">
              A loose Diamond where any two rules cross.
            </span>
          </div>
        </Block>

        <Block
          description="Five knobs on :root. Every scheme can set them."
          title="Tweaks"
        >
          <div className="border border-line">
            {KNOBS.map((knob) => (
              <div
                className="grid grid-cols-[6rem_4rem_1fr] gap-3 border-line border-b px-3 py-2 last:border-b-0"
                key={knob.token}
              >
                <code className="type-caption text-foreground">
                  {knob.token}
                </code>
                <span className="type-caption text-muted-foreground tabular-nums">
                  {knob.value}
                </span>
                <span className="type-caption text-muted-foreground">
                  {knob.use}
                </span>
              </div>
            ))}
          </div>
        </Block>
      </BlockGrid>
    </Section>
  );
}
