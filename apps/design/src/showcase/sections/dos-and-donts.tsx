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
  Moon,
  Share2,
  Sun,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Block, BlockGrid, Example, Section } from "../layout";
import { useScheme } from "../theme";

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

function OneCobaltAction() {
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
          <Note>Two cobalt buttons: neither one is the next step.</Note>
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
          <Note>The primary says what comes next; the rest sit on paper.</Note>
        </>
      }
      rule="One cobalt action per group. Everything beside it is outline, secondary or ghost."
      title="One primary per group"
    />
  );
}

function ScarceBlue() {
  return (
    <Pair
      bad={
        <Card className="w-full max-w-sm border-primary" size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
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
            <Button size="sm" variant="link">
              Preview
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
          </CardContent>
        </Card>
      }
      rule="The blue is the one saturated colour: one cobalt moment in view. Badges, borders, icons and titles stay neutral."
      title="Keep the blue scarce"
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
          <h4 className="type-title">Work experience</h4>
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
      rule="Pick a role by purpose. Hierarchy comes from size and weight: no all-caps, no letter-spacing, bold only for display."
      title="Roles, not pixels"
    />
  );
}

function SquareCards() {
  return (
    <Pair
      bad={
        // A 16px radius has no token on purpose; shadow-float belongs to
        // windows. Both are the rule being broken.
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
      rule="Cards are square and flat on a hairline. Only buttons (4px) and chips (2px) round; shadows belong to windows."
      title="Square cards, hairlines"
    />
  );
}

const PARAGRAPH =
  "Rina built the attendance app her lab still uses, from paper forms to a working PWA in six weeks.";

function InkBody() {
  return (
    <Pair
      bad={
        <>
          <p className="type-body max-w-prose text-foreground">{PARAGRAPH}</p>
          <Note>
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <span aria-hidden="true" className="size-2.5 bg-current" />
              foreground
            </span>{" "}
            · the heading colour, pure black in light
          </Note>
        </>
      }
      good={
        <>
          <p className="type-body max-w-prose">{PARAGRAPH}</p>
          <Note>
            <span className="inline-flex items-center gap-1.5 text-ink">
              <span aria-hidden="true" className="size-2.5 bg-current" />
              ink
            </span>{" "}
            · inherited from the page, about 10:1 on paper
          </Note>
        </>
      }
      rule="Running text inherits ink, a blue-grey. Foreground is for headings, labels and controls, never paragraphs."
      title="Body copy in ink"
    />
  );
}

function WorkingShortcuts() {
  const { scheme, setScheme } = useScheme();
  const dark = scheme === "dark";
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
            <Button
              onClick={() => setScheme(dark ? "light" : "dark")}
              variant="outline"
            >
              {dark ? (
                <Sun aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Moon aria-hidden="true" data-icon="inline-start" />
              )}
              {dark ? "Light" : "Night Desk"}
              <Kbd>T</Kbd>
            </Button>
          </div>
          <Note>T switches the theme from anywhere on this page. Try it.</Note>
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
          <pre className="type-body-compact w-full overflow-x-auto border border-border bg-card px-3 py-2 text-foreground">
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
      lead="The DESIGN.md rules that are easiest to break, rendered side by side. Every Don't is real markup that breaks its rule."
      title="Do and don't"
    >
      <BlockGrid>
        <OneCobaltAction />
        <ScarceBlue />
        <RolesNotPixels />
        <SquareCards />
        <InkBody />
        <WorkingShortcuts />
        <SyntaxInTheEditor />
      </BlockGrid>
    </Section>
  );
}
