import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@rulisme/ui/ui/card";
import { Kbd, KbdGroup } from "@rulisme/ui/ui/kbd";
import {
  Check,
  Cloud,
  Copy,
  Download,
  FileText,
  Layers,
  Share2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Block, BlockGrid, Example, Section } from "../layout";

/*
 * The DESIGN.md rules that are easiest to break, each as a rendered pair.
 * Every "Don't" is real markup that breaks the rule, built from the system's
 * own tokens arranged wrongly (or a non-font inline style, where no token
 * can break the rule), so the lint stays clean for the rest of the page.
 */

function DoLabel() {
  return (
    <span className="flex items-center gap-1 text-foreground">
      <Check aria-hidden="true" className="size-3" />
      Do
    </span>
  );
}

function DontLabel() {
  return (
    <span className="flex items-center gap-1 text-destructive">
      <X aria-hidden="true" className="size-3" />
      Don't
    </span>
  );
}

/** One rule: its name, the rule in one line, then Do beside Don't. */
function Pair({
  title,
  rule,
  good,
  bad,
}: {
  title: string;
  rule: string;
  good: ReactNode;
  bad: ReactNode;
}) {
  return (
    <Block description={rule} title={title} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Example className="flex-1" label={<DoLabel />} stack>
          {good}
        </Example>
        <Example className="flex-1" label={<DontLabel />} stack>
          {bad}
        </Example>
      </div>
    </Block>
  );
}

/** A muted line under a specimen saying what to look at. */
function Note({ children }: { children: ReactNode }) {
  return <p className="type-caption text-muted-foreground">{children}</p>;
}

/* ── The pairs ─────────────────────────────────────────────────────────── */

function OnePrimaryAction() {
  return (
    <Pair
      bad={
        <>
          <div className="flex flex-wrap gap-2">
            <Button>
              <Download aria-hidden="true" data-icon="inline-start" />
              Download PDF
            </Button>
            <Button>
              <Cloud aria-hidden="true" data-icon="inline-start" />
              Save draft
            </Button>
          </div>
          <Note>Two light primary pills: neither one is the next step.</Note>
        </>
      }
      good={
        <>
          <div className="flex flex-wrap gap-2">
            <Button>
              <Download aria-hidden="true" data-icon="inline-start" />
              Download PDF
            </Button>
            <Button variant="outline">
              <Cloud aria-hidden="true" data-icon="inline-start" />
              Save draft
            </Button>
          </div>
          <Note>
            The light pill says what comes next; the rest are outlined.
          </Note>
        </>
      }
      rule="One light primary pill per group. Everything beside it is secondary, outline or ghost."
      title="One primary per group"
    />
  );
}

function OrangeForLinks() {
  return (
    <Pair
      bad={
        <Card className="w-full max-w-sm border-link" size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-link">
              <FileText aria-hidden="true" className="size-3.5" />
              Rina Wulandari, CV
            </CardTitle>
            <CardDescription>Edited 2 hours ago</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge>Draft</Badge>
            <Badge>A4</Badge>
            <Button size="sm">
              <Share2 aria-hidden="true" data-icon="inline-start" />
              Share link
            </Button>
          </CardContent>
        </Card>
      }
      good={
        <Card className="w-full max-w-sm" size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              Rina Wulandari, CV
            </CardTitle>
            <CardDescription>Edited 2 hours ago</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Draft</Badge>
            <Badge variant="outline">A4</Badge>
            <Button size="sm">
              <Share2 aria-hidden="true" data-icon="inline-start" />
              Share link
            </Button>
            <Button size="sm" variant="link">
              Preview
            </Button>
          </CardContent>
        </Card>
      }
      rule="Orange #f54e00 is for text links (and at most one highlighted badge). Titles, borders, icons and status chips stay in ink and grey."
      title="Orange is for links"
    />
  );
}

function RolesNotPixels() {
  return (
    <Pair
      bad={
        <div className="flex flex-col gap-1">
          {/* Letter-spacing has no token on purpose; this inline style is
              the rule being broken. */}
          <p
            className="type-micro weight-bold text-muted-foreground"
            style={{ letterSpacing: "0.16em" }}
          >
            STEP 2 OF 4
          </p>
          <h4 className="type-title weight-bold">Work experience</h4>
          <p className="type-body">Newest first, one line of impact each.</p>
        </div>
      }
      good={
        <div className="flex flex-col gap-1">
          <p className="type-caption text-muted-foreground">Step 2 of 4</p>
          <h4 className="type-title">Work experience</h4>
          <p className="type-body">Newest first, one line of impact each.</p>
        </div>
      }
      rule="Pick a role by purpose. Hierarchy comes from size alone: everything is weight 400, no all-caps, no letter-spacing beyond what the role bakes in, no bold headings."
      title="Roles, not pixels"
    />
  );
}

function FlatCards() {
  return (
    <Pair
      bad={
        // A 16px radius has no token on purpose; shadow-float belongs to
        // windows and flyouts. Both are the rule being broken.
        <Card
          className="w-full max-w-sm shadow-float"
          style={{ borderRadius: 16 }}
        >
          <CardHeader>
            <CardTitle>Academy portfolio</CardTitle>
            <CardDescription>6 slides · draft</CardDescription>
          </CardHeader>
          <CardContent>
            <p>One project per slide, screenshots in a dashed frame.</p>
          </CardContent>
        </Card>
      }
      good={
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Academy portfolio</CardTitle>
            <CardDescription>6 slides · draft</CardDescription>
          </CardHeader>
          <CardContent>
            <p>One project per slide, screenshots in a dashed frame.</p>
          </CardContent>
        </Card>
      }
      rule="Cards are one step lighter than the page, on a 2.5% hairline with 4px corners and no shadow. Shadows belong to flyouts and windows."
      title="Flat cards, 4px corners"
    />
  );
}

function GreyThatReads() {
  return (
    <Pair
      bad={
        <>
          <p className="type-body text-foreground">Rina Wulandari, CV</p>
          <p className="type-caption text-offgray">
            Saved to the cloud 2 minutes ago · 2 pages · A4
          </p>
          <Note>
            Offgray (40%) is for decoration: at 12px it falls under 4.5:1.
          </Note>
        </>
      }
      good={
        <>
          <p className="type-body text-foreground">Rina Wulandari, CV</p>
          <p className="type-caption text-muted-foreground">
            Saved to the cloud 2 minutes ago · 2 pages · A4
          </p>
          <Note>
            Muted (60%) for small grey text; ink-sec for grey text at 18px and
            up; ink-mid (50%) only for meta at 16px and up.
          </Note>
        </>
      }
      rule="Grey text is ink at a fixed strength chosen by size, never a lighter grey because it looks calmer."
      title="Grey text that still reads"
    />
  );
}

function WorkingShortcuts() {
  return (
    <Pair
      bad={
        <>
          <div>
            <Button variant="outline">
              <Copy aria-hidden="true" data-icon="inline-start" />
              Duplicate CV
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>D</Kbd>
              </KbdGroup>
            </Button>
          </div>
          <Note>
            Nothing listens for ⌘D here; the browser bookmarks the page.
          </Note>
        </>
      }
      good={
        <>
          <div>
            <Button asChild variant="outline">
              <a href="#foundations">
                <Layers aria-hidden="true" data-icon="inline-start" />
                Foundations
                <Kbd>F</Kbd>
              </a>
            </Button>
          </div>
          <Note>
            F jumps to Foundations from anywhere on this page. Try it.
          </Note>
        </>
      }
      rule="A Kbd hint only on an action whose key works. Render the hint and register the key together, never one without the other."
      title="Shortcuts that work"
    />
  );
}

function SyntaxInTheEditor() {
  return (
    <Pair
      bad={
        <>
          <div className="flex flex-wrap gap-2">
            <Badge className="border-syn-2/40 text-syn-2" variant="outline">
              Ready
            </Badge>
            <Badge className="border-syn-4/40 text-syn-4" variant="outline">
              Draft
            </Badge>
            <Badge className="border-syn-3/40 text-syn-3" variant="outline">
              Export failed
            </Badge>
            <Badge className="border-syn-1/40 text-syn-1" variant="outline">
              Shared
            </Badge>
          </div>
          <Note>
            Status in syntax colours: a second palette outside the code.
          </Note>
        </>
      }
      good={
        <>
          <pre className="type-body-compact w-full overflow-x-auto rounded-sm border border-border bg-background px-3 py-2 text-foreground">
            <span className="text-syn-1">"status"</span>:{" "}
            <span className="text-syn-2">"ready"</span>,{"\n"}
            <span className="text-syn-1">"pages"</span>:{" "}
            <span className="text-syn-3">2</span>,{"\n"}
            <span className="text-syn-1">"shared"</span>:{" "}
            <span className="text-syn-4">true</span>
          </pre>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Ready</Badge>
            <Badge variant="outline">Shared</Badge>
          </div>
        </>
      }
      rule="Syntax colours live inside the editor. Outside it, status is a word on a neutral badge."
      title="Syntax colours stay in code"
    />
  );
}

// Renders the DESIGN.md Do's and Don'ts as rendered pairs.
export function DosAndDontsSection() {
  return (
    <Section
      id="dos-and-donts"
      lead="The rules that are easiest to break, rendered side by side. Every Don't is real markup that breaks its rule."
      title="Do and don't"
    >
      <BlockGrid>
        <OnePrimaryAction />
        <OrangeForLinks />
        <RolesNotPixels />
        <FlatCards />
        <GreyThatReads />
        <WorkingShortcuts />
        <SyntaxInTheEditor />
      </BlockGrid>
    </Section>
  );
}
