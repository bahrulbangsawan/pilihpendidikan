import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Badge } from "@rulisme/ui/ui/badge";
import { badgeVariants } from "@rulisme/ui/ui/badge-variants";
import { Button } from "@rulisme/ui/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@rulisme/ui/ui/button-group";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd, KbdGroup } from "@rulisme/ui/ui/kbd";
import { Spinner } from "@rulisme/ui/ui/spinner";
import { Toggle } from "@rulisme/ui/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@rulisme/ui/ui/toggle-group";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  ArrowUpRight,
  Bold,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Download,
  Eye,
  FileText,
  Image,
  Italic,
  Minus,
  MoreHorizontal,
  Plus,
  Redo2,
  Share2,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Block, BlockGrid, Example, Section } from "../layout";
import { previewState, StateMatrix } from "../state-matrix";
import { useScheme } from "../theme";

// Every Kbd hint in this section names a key that works on this page: D and
// E below, F (overview), T (theme), S (share dialog, overlays).
const OPEN_LAYER =
  "[data-slot=dialog-content], [data-slot=alert-dialog-content], [data-slot=sheet-content], [data-slot=drawer-content], [data-slot=select-content]";

function downloadPdf() {
  toast.success("PDF ready", {
    description: "rina-wulandari-cv.pdf · 2 pages, A4",
  });
}

function exportJson() {
  toast.success("JSON exported", {
    description: "rina-wulandari-cv.json · import it again on any device",
  });
}

/** D downloads and E exports, like the hints on their buttons say. */
function useActionShortcuts() {
  useShortcut("d", () => {
    if (!document.querySelector(OPEN_LAYER)) {
      downloadPdf();
    }
  });
  useShortcut("e", () => {
    if (!document.querySelector(OPEN_LAYER)) {
      exportJson();
    }
  });
}

const BUTTON_VARIANTS = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

const BUTTON_STATES = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
] as const;

const BUTTON_WHEN: Record<
  (typeof BUTTON_VARIANTS)[number],
  { label: string; icon: ReactNode; when: string }
> = {
  default: {
    label: "Download PDF",
    icon: <Download aria-hidden="true" data-icon="inline-start" />,
    when: "The one action that matters in view: solid cobalt with a darker lip. One per group.",
  },
  outline: {
    label: "Save draft",
    icon: <Cloud aria-hidden="true" data-icon="inline-start" />,
    when: "The secondary action: paper at 60%, a 60% border and a grey lip.",
  },
  secondary: {
    label: "Duplicate",
    icon: <Copy aria-hidden="true" data-icon="inline-start" />,
    when: "A neutral filled control when outline is too quiet; keeps the blue scarce.",
  },
  ghost: {
    label: "Preview",
    icon: <Eye aria-hidden="true" data-icon="inline-start" />,
    when: "Nav links and toolbar actions: no fill until hover.",
  },
  destructive: {
    label: "Delete CV",
    icon: <Trash2 aria-hidden="true" data-icon="inline-start" />,
    when: "Removes something for good. Confirm it in an alert dialog first.",
  },
  link: {
    label: "Read the guide",
    icon: null,
    when: "Inline navigation in cobalt; it ends in a › chevron unless it carries an icon.",
  },
};

const BUTTON_SIZES = [
  { size: "xs", label: "xs · 24px" },
  { size: "sm", label: "sm · 32px" },
  { size: "default", label: "default · 36px" },
  { size: "lg", label: "lg · 40px" },
] as const;

const ICON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

const BADGE_VARIANTS = [
  {
    variant: "secondary",
    label: "Draft",
    when: "Status and meta: the default.",
  },
  {
    variant: "outline",
    label: "PDF",
    when: "Formats, tags and filters on paper.",
  },
  {
    variant: "default",
    label: "New",
    when: "Spends the blue: only when the badge is the one cobalt thing in view.",
  },
  {
    variant: "destructive",
    label: "Expired",
    when: "Errors and expired links.",
  },
  {
    variant: "ghost",
    label: "3 views",
    when: "Quiet meta that needs no chip.",
  },
  { variant: "link", label: "View CV", when: "A badge that navigates." },
] as const;

const BADGE_ROWS = BADGE_VARIANTS.map((badge) => badge.variant);

const TOGGLE_STATES = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "on",
] as const;

function ButtonBlock() {
  return (
    <Block
      description="36px tall (32px in the nav), 0 12px 0 10px around a leading 14px icon, body role, 4px radius. Primary is solid blue with a darker 2px inset lip; secondary is paper at 60% with a grey lip. The lip drops on hover and the button presses 1px on click."
      title="Button"
      wide
    >
      <Example label="Typical: the CV builder toolbar · press D" paper>
        <Button onClick={downloadPdf}>
          <Download aria-hidden="true" data-icon="inline-start" />
          Download PDF
          <Kbd>D</Kbd>
        </Button>
        <Button variant="outline">
          <Cloud aria-hidden="true" data-icon="inline-start" />
          Save draft
        </Button>
        <Button variant="ghost">
          <Eye aria-hidden="true" data-icon="inline-start" />
          Preview
        </Button>
      </Example>

      <div className="grid gap-4 md:grid-cols-2">
        <Example label="Variants, in priority order" stack>
          {BUTTON_VARIANTS.map((variant) => {
            const spec = BUTTON_WHEN[variant];
            return (
              <div
                className="grid gap-2 sm:grid-cols-[9.5rem_1fr] sm:items-center sm:gap-4"
                key={variant}
              >
                <div>
                  <Button variant={variant}>
                    {spec.icon}
                    {spec.label}
                  </Button>
                </div>
                <p className="type-caption text-muted-foreground">
                  <span className="text-foreground">{variant}</span> ·{" "}
                  {spec.when}
                </p>
              </div>
            );
          })}
        </Example>

        <div className="flex min-w-0 flex-col gap-4">
          <Example label="Sizes, smallest to largest">
            {BUTTON_SIZES.map(({ size, label }) => (
              <div className="flex flex-col items-start gap-2" key={size}>
                <Button size={size} variant="outline">
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Add section
                </Button>
                <span className="type-micro text-muted-foreground">
                  {label}
                </span>
              </div>
            ))}
          </Example>
          <Example label="Icon-only sizes, level with their text sizes">
            {ICON_SIZES.map((size) => (
              <div className="flex flex-col items-start gap-2" key={size}>
                <Button aria-label="More actions" size={size} variant="outline">
                  <MoreHorizontal aria-hidden="true" />
                </Button>
                <span className="type-micro text-muted-foreground">{size}</span>
              </div>
            ))}
          </Example>
          <Example label="With icon: leading, trailing, icon-only, shortcut">
            <Button variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add experience
            </Button>
            <Button variant="outline">
              Next step
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            <Button aria-label="Share CV link" size="icon" variant="ghost">
              <Share2 aria-hidden="true" />
            </Button>
            <Button onClick={exportJson} variant="outline">
              <FileText aria-hidden="true" data-icon="inline-start" />
              Export JSON
              <Kbd>E</Kbd>
            </Button>
          </Example>
        </div>
      </div>

      <StateMatrix
        render={(variant, state) =>
          state === "loading" ? (
            <Button disabled variant={variant}>
              <Spinner data-icon="inline-start" />
              Save draft
            </Button>
          ) : (
            <Button variant={variant} {...previewState(state)}>
              Save draft
            </Button>
          )
        }
        rows={BUTTON_VARIANTS}
        states={BUTTON_STATES}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Example label="buttonVariants on a link, and asChild">
          <a
            className={buttonVariants({ variant: "outline" })}
            href="https://cv.pilihpendidikan.com"
            rel="noopener"
            target="_blank"
          >
            Open the CV builder
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </a>
          <Button asChild variant="link">
            <a href="#inputs">Fill in your details</a>
          </Button>
        </Example>
        <Example label="Long label: truncates inside its width" stack>
          <Button className="max-w-64" variant="outline">
            <FileText aria-hidden="true" data-icon="inline-start" />
            <span className="min-w-0 truncate">
              Rina Wulandari — CV Universitas Brawijaya 2026 (final).pdf
            </span>
          </Button>
          <Button className="w-full" variant="secondary">
            <Download aria-hidden="true" data-icon="inline-start" />
            Download all three documents
          </Button>
        </Example>
      </div>
    </Block>
  );
}

function ButtonGroupBlock() {
  return (
    <Block
      description="Related actions joined into one control. Neighbours share a single hairline and only the outer corners keep the 4px radius."
      title="ButtonGroup"
    >
      <Example label="Typical: a split action" paper>
        <ButtonGroup aria-label="Export">
          <Button variant="outline">
            <Download aria-hidden="true" data-icon="inline-start" />
            Export PDF
          </Button>
          <Button
            aria-label="More export formats"
            size="icon"
            variant="outline"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </ButtonGroup>
        <ButtonGroup aria-label="History">
          <Button aria-label="Undo" size="icon" variant="outline">
            <Undo2 aria-hidden="true" />
          </Button>
          <Button aria-label="Redo" size="icon" variant="outline">
            <Redo2 aria-hidden="true" />
          </Button>
        </ButtonGroup>
      </Example>
      <Example label="With text and a field" stack>
        <ButtonGroup aria-label="Promo code" className="w-full">
          <ButtonGroupText>Kode promo</ButtonGroupText>
          <Input aria-label="Promo code" placeholder="PILIH2026" />
          <Button variant="outline">Apply</Button>
        </ButtonGroup>
        <ButtonGroup aria-label="Share link">
          <Button variant="secondary">
            <Copy aria-hidden="true" data-icon="inline-start" />
            Copy link
          </Button>
          <ButtonGroupSeparator />
          <Button aria-label="Share" size="icon" variant="secondary">
            <Share2 aria-hidden="true" />
          </Button>
        </ButtonGroup>
      </Example>
      <Example label="Vertical, and nested groups">
        <ButtonGroup aria-label="Zoom" orientation="vertical">
          <Button aria-label="Zoom in" size="icon-sm" variant="outline">
            <Plus aria-hidden="true" />
          </Button>
          <Button aria-label="Zoom out" size="icon-sm" variant="outline">
            <Minus aria-hidden="true" />
          </Button>
        </ButtonGroup>
        <ButtonGroup aria-label="Editor toolbar">
          <ButtonGroup>
            <Button size="sm" variant="outline">
              Back
            </Button>
            <Button size="sm" variant="outline">
              Next
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button size="sm">Publish</Button>
          </ButtonGroup>
        </ButtonGroup>
      </Example>
    </Block>
  );
}

function ToggleBlock() {
  return (
    <Block
      description="A two-state pressable. Ghost for toolbars, outline for options on paper; on, it fills pane-2 and its label goes semibold."
      title="Toggle"
    >
      <Example label="Typical: preview options" paper>
        <Toggle aria-label="Bold" defaultPressed>
          <Bold aria-hidden="true" />
        </Toggle>
        <Toggle aria-label="Italic">
          <Italic aria-hidden="true" />
        </Toggle>
        <Toggle defaultPressed variant="outline">
          <Image aria-hidden="true" data-icon="inline-start" />
          Show photo
        </Toggle>
      </Example>
      <Example label="Sizes: sm · default · lg">
        {(["sm", "default", "lg"] as const).map((size) => (
          <Toggle key={size} size={size} variant="outline">
            <Eye aria-hidden="true" data-icon="inline-start" />
            Preview
          </Toggle>
        ))}
      </Example>
      <StateMatrix
        render={(variant, state) => (
          <Toggle
            aria-label="Bold"
            pressed={state === "on"}
            variant={variant}
            {...previewState(state)}
          >
            <Bold aria-hidden="true" />
          </Toggle>
        )}
        rows={["default", "outline"] as const}
        states={TOGGLE_STATES}
      />
    </Block>
  );
}

function ToggleGroupBlock() {
  return (
    <Block
      description="Option sets of two to seven choices: outlined segments joined edge to edge, one shared hairline between them and a 4px outer radius. The chosen segment fills pane-2 and goes semibold."
      title="ToggleGroup"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Example label="Typical: one choice" paper stack>
          <ToggleGroup
            aria-label="CV template"
            defaultValue="modern"
            type="single"
          >
            <ToggleGroupItem value="classic">Classic</ToggleGroupItem>
            <ToggleGroupItem value="modern">Modern</ToggleGroupItem>
            <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup aria-label="Page size" defaultValue="a4" type="single">
            <ToggleGroupItem value="a4">A4</ToggleGroupItem>
            <ToggleGroupItem value="letter">Letter</ToggleGroupItem>
          </ToggleGroup>
        </Example>
        <Example label="Icons, several choices, sizes" stack>
          <ToggleGroup
            aria-label="Text alignment"
            defaultValue="left"
            type="single"
          >
            <ToggleGroupItem aria-label="Align left" value="left">
              <AlignLeft aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="Align centre" value="center">
              <AlignCenter aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="Align right" value="right">
              <AlignRight aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            aria-label="Text style"
            defaultValue={["bold"]}
            type="multiple"
          >
            <ToggleGroupItem aria-label="Bold" value="bold">
              <Bold aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="Italic" value="italic">
              <Italic aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="Underline" value="underline">
              <Underline aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex flex-wrap items-center gap-3">
            {(["sm", "default", "lg"] as const).map((size) => (
              <ToggleGroup
                aria-label={`Period, ${size}`}
                defaultValue="month"
                key={size}
                size={size}
                type="single"
              >
                <ToggleGroupItem value="month">Month</ToggleGroupItem>
                <ToggleGroupItem value="year">Year</ToggleGroupItem>
              </ToggleGroup>
            ))}
          </div>
        </Example>
        <Example label="Ghost toolbar, separate chips, vertical">
          <ToggleGroup
            aria-label="Sections"
            defaultValue={["experience"]}
            type="multiple"
            variant="default"
          >
            <ToggleGroupItem value="experience">Experience</ToggleGroupItem>
            <ToggleGroupItem value="education">Education</ToggleGroupItem>
            <ToggleGroupItem value="projects">Projects</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            aria-label="Language"
            defaultValue="en"
            spacing={2}
            type="single"
          >
            <ToggleGroupItem value="en">English</ToggleGroupItem>
            <ToggleGroupItem value="id">Bahasa Indonesia</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            aria-label="Paper"
            defaultValue="portrait"
            orientation="vertical"
            type="single"
          >
            <ToggleGroupItem value="portrait">Portrait</ToggleGroupItem>
            <ToggleGroupItem value="landscape">Landscape</ToggleGroupItem>
          </ToggleGroup>
        </Example>
        <Example label="A disabled option" stack>
          <ToggleGroup
            aria-label="Export format"
            defaultValue="pdf"
            type="single"
          >
            <ToggleGroupItem value="pdf">PDF</ToggleGroupItem>
            <ToggleGroupItem value="json">JSON</ToggleGroupItem>
            <ToggleGroupItem disabled value="docx">
              DOCX
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="type-caption text-muted-foreground">
            DOCX export arrives with the next builder release.
          </p>
        </Example>
      </div>
      <StateMatrix
        render={(variant, state) => (
          <ToggleGroup
            aria-label="Period"
            defaultValue={state === "on" ? "month" : undefined}
            type="single"
            variant={variant === "ghost" ? "default" : "outline"}
          >
            <ToggleGroupItem value="month" {...previewState(state)}>
              Month
            </ToggleGroupItem>
            <ToggleGroupItem value="year">Year</ToggleGroupItem>
          </ToggleGroup>
        )}
        rows={["outline", "ghost"] as const}
        states={TOGGLE_STATES}
      />
    </Block>
  );
}

function BadgeBlock() {
  return (
    <Block
      description="Tiny badges: a 2px chip in the micro role. Secondary and outline by default; default spends the blue."
      title="Badge"
    >
      <Example label="Typical: a saved document" paper>
        <span className="type-body text-foreground">Rina Wulandari — CV</span>
        <Badge variant="secondary">Draft</Badge>
        <Badge variant="outline">A4</Badge>
        <Badge variant="outline">English</Badge>
      </Example>
      <Example label="Variants, in priority order" stack>
        {BADGE_VARIANTS.map((badge) => (
          <div
            className="grid grid-cols-[5.5rem_1fr] items-center gap-4"
            key={badge.variant}
          >
            <div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="type-caption text-muted-foreground">
              <span className="text-foreground">{badge.variant}</span> ·{" "}
              {badge.when}
            </p>
          </div>
        ))}
      </Example>
      <Example label="Icons, counters, links, long text">
        <Badge variant="secondary">
          <Check aria-hidden="true" data-icon="inline-start" />
          Saved
        </Badge>
        <Badge variant="outline">
          Portfolio
          <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
        </Badge>
        <Badge className="tabular-nums" variant="secondary">
          3 of 5 projects
        </Badge>
        <a className={badgeVariants({ variant: "outline" })} href="#inputs">
          Edit details
        </a>
        <Badge className="max-w-40" variant="outline">
          <span className="truncate">
            Universitas Brawijaya, Malang, Jawa Timur
          </span>
        </Badge>
      </Example>
      <StateMatrix
        render={(variant, state) => (
          <Badge asChild variant={variant}>
            <a href="#actions" {...previewState(state)}>
              Draft
            </a>
          </Badge>
        )}
        rows={BADGE_ROWS}
        states={["default", "hover", "focus"]}
      />
    </Block>
  );
}

function KbdBlock() {
  const { scheme, setScheme } = useScheme();
  const dark = scheme === "dark";
  return (
    <Block
      description="Shortcut hints: 20px, 2px radius, the micro role in muted ink on half-transparent paper. Inside a primary button the cap turns translucent white."
      title="Kbd"
    >
      <Example label="Typical: in running text" paper>
        <p className="type-body">
          Press <Kbd>T</Kbd> for Night Desk, <Kbd>S</Kbd> to share a read-only
          link and <Kbd>D</Kbd> to download the PDF.
        </p>
      </Example>
      <Example label="KbdGroup: chords and sequences">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>P</Kbd>
        </KbdGroup>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <span className="type-caption text-muted-foreground">+</span>
          <Kbd>K</Kbd>
        </KbdGroup>
        <KbdGroup>
          <Kbd>Shift</Kbd>
          <Kbd>Enter</Kbd>
        </KbdGroup>
      </Example>
      <Example label="Inside buttons: primary, secondary, ghost · every key works">
        <Button onClick={downloadPdf}>
          Download
          <Kbd>D</Kbd>
        </Button>
        <Button asChild variant="outline">
          <a href="#foundations">
            Foundations
            <Kbd>F</Kbd>
          </a>
        </Button>
        <Button
          onClick={() => setScheme(dark ? "light" : "dark")}
          size="sm"
          variant="ghost"
        >
          {dark ? "Light" : "Night Desk"}
          <Kbd>T</Kbd>
        </Button>
      </Example>
    </Block>
  );
}

// Renders: Button, ButtonGroup, Toggle, ToggleGroup, Badge, Kbd.
export function ActionsSection() {
  useActionShortcuts();
  return (
    <Section
      id="actions"
      lead="Buttons, groups, toggles, badges and keyboard hints. One cobalt action per group; everything else on paper."
      title="Actions"
    >
      <BlockGrid>
        <ButtonBlock />
        <ButtonGroupBlock />
        <ToggleBlock />
        <ToggleGroupBlock />
        <BadgeBlock />
        <KbdBlock />
      </BlockGrid>
    </Section>
  );
}
