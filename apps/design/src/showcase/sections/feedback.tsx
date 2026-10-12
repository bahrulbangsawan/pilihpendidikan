import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@rulisme/ui/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Progress } from "@rulisme/ui/ui/progress";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Toaster } from "@rulisme/ui/ui/sonner";
import { Spinner } from "@rulisme/ui/ui/spinner";
import {
  CircleAlert,
  CloudOff,
  FilePlus,
  FileText,
  Info,
  Upload,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Block, BlockGrid, Example, Section } from "../layout";
import { useScheme } from "../theme";

/* ── Alert ─────────────────────────────────────────────────────────────── */

function AlertBlock() {
  return (
    <Block
      description="Callouts that stay in the page: square, bordered, on bg-2. Destructive tints the border, text and icon; the surface stays paper."
      title="Alert"
    >
      <Example label="default · with an action" stack>
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>Your CV is saved in this browser only</AlertTitle>
          <AlertDescription>
            Connect a personal token to keep a cloud copy and share a read-only
            link.
          </AlertDescription>
          <AlertAction>
            <Button size="xs" variant="outline">
              Connect
            </Button>
          </AlertAction>
        </Alert>
      </Example>
      <Example label="destructive · an error to act on" stack>
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Export failed</AlertTitle>
          <AlertDescription>
            The PDF renderer ran out of memory on page 3. Remove the 12 MB
            profile photo and export again.
          </AlertDescription>
        </Alert>
      </Example>
      <Example label="no icon · long text wraps" stack>
        <Alert>
          <AlertTitle>
            Applications for the Apple Developer Academy 2027 cohort close on 15
            December 2026
          </AlertTitle>
          <AlertDescription>
            Your portfolio needs at least three projects with screenshots.{" "}
            <a href="#feedback">Read the checklist</a>.
          </AlertDescription>
        </Alert>
      </Example>
    </Block>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────────── */

const CLOUD_SAVE_MS = 2000;

function ToastBlock() {
  const { scheme } = useScheme();
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    },
    []
  );

  const saveToCloud = () => {
    const id = toast.loading("Saving to the cloud…");
    timers.current.push(
      window.setTimeout(() => {
        toast.success("Saved to the cloud", {
          id,
          description: "api.pilihpendidikan.com · 14:32",
        });
      }, CLOUD_SAVE_MS)
    );
  };

  return (
    <Block
      description="Short-lived confirmation in a window at the corner of the screen: a semibold title and one caption. Sonner's own stacking and swipe are the only motion; loading uses the Blocks spinner."
      title="Toast"
    >
      <Example label="each button fires a toast (bottom right)">
        <Button
          onClick={() =>
            toast.success("Draft saved", {
              description: "Saved to this browser at 14:32.",
            })
          }
          variant="outline"
        >
          Save draft
        </Button>
        <Button
          onClick={() =>
            toast.error("Export failed", {
              description: "The PDF renderer ran out of memory on page 3.",
              closeButton: true,
            })
          }
          variant="outline"
        >
          Export PDF
        </Button>
        <Button onClick={saveToCloud} variant="outline">
          Sync to cloud
        </Button>
        <Button
          onClick={() =>
            toast("Experience entry deleted", {
              description: "Software Engineer Intern · Gojek",
              action: {
                label: "Undo",
                onClick: () => toast.success("Entry restored"),
              },
            })
          }
          variant="outline"
        >
          Delete entry
        </Button>
      </Example>
      <Toaster theme={scheme} />
    </Block>
  );
}

/* ── Progress ──────────────────────────────────────────────────────────── */

const UPLOADS = [
  { id: "photo", label: "Profile photo", detail: "3.2 of 5 MB", value: 64 },
  {
    id: "cv",
    label: "Profile complete",
    detail: "6 of 6 sections",
    value: 100,
  },
  { id: "deck", label: "Portfolio slides", detail: "0 of 6 slides", value: 0 },
] as const;

function ProgressBlock() {
  return (
    <Block
      description="A 4px pane-2 track with a cobalt fill, for work whose end is known. The fill jumps to each value."
      title="Progress"
    >
      <Example stack>
        {UPLOADS.map((upload) => (
          <div className="flex flex-col gap-2" key={upload.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-body text-foreground" id={upload.id}>
                {upload.label}
              </span>
              <span className="type-caption text-muted-foreground tabular-nums">
                {upload.detail}
              </span>
            </div>
            <Progress aria-labelledby={upload.id} value={upload.value} />
          </div>
        ))}
      </Example>
    </Block>
  );
}

/* ── Spinner ───────────────────────────────────────────────────────────── */

function SpinnerBlock() {
  return (
    <Block
      description="The Blocks loader, the one thing that keeps moving. 14px inline beside text, 20px for a panel; give it a label when no visible text says what is loading."
      title="Spinner"
    >
      <Example label="sizes · sm inline, md panel">
        <span className="type-body flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Saving…
        </span>
        <Spinner className="text-muted-foreground" size="md" />
      </Example>
      <Example label="inside a button · disabled while it runs">
        <Button disabled>
          <Spinner data-icon="inline-start" />
          Exporting PDF
        </Button>
        <Button disabled variant="outline">
          <Spinner data-icon="inline-start" />
          Importing JSON
        </Button>
      </Example>
      <Example label="panel loader · announced by its label">
        <div className="flex h-32 w-full items-center justify-center border border-line bg-card">
          <Spinner
            className="text-muted-foreground"
            label="Loading your CV"
            size="md"
          />
        </div>
      </Example>
    </Block>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────── */

function SkeletonBlock() {
  return (
    <Block
      description="Static pane placeholders in the shape of what is coming. They never pulse."
      title="Skeleton"
    >
      <Example label="card" stack>
        <Card aria-hidden="true" className="w-full">
          <CardHeader>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </CardContent>
          <CardFooter>
            <Skeleton className="h-8 w-28" />
          </CardFooter>
        </Card>
      </Example>
      <Example label="item rows" stack>
        <div aria-hidden="true" className="flex w-full flex-col">
          {["first", "second", "third"].map((row) => (
            <div
              className="flex items-center gap-3 border-line border-b py-3 last:border-b-0"
              key={row}
            >
              <Skeleton className="size-8" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </Example>
    </Block>
  );
}

/* ── Empty ─────────────────────────────────────────────────────────────── */

function EmptyBlock() {
  return (
    <Block
      description="When there is nothing yet: a framed icon tile, a title, one line of help and the next action. A dashed frame and graph paper mark a place to start."
      title="Empty"
    >
      <Example stack>
        <Empty className="graph-paper border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No CVs yet</EmptyTitle>
            <EmptyDescription>
              Start from a template or import a JSON file you exported earlier.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button>
              <FilePlus aria-hidden="true" data-icon="inline-start" />
              New CV
            </Button>
            <Button variant="outline">
              <Upload aria-hidden="true" data-icon="inline-start" />
              Import JSON
            </Button>
          </EmptyContent>
        </Empty>
      </Example>
      <Example label="error · nothing to show because loading failed" stack>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CloudOff aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Couldn't load your invoices</EmptyTitle>
            <EmptyDescription>
              api.pilihpendidikan.com did not answer. Your drafts in this
              browser are safe.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline">
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </Example>
    </Block>
  );
}

// Renders: Alert, Sonner, Progress, Spinner, Skeleton, Empty.
export function FeedbackSection() {
  return (
    <Section
      id="feedback"
      lead="Status in words and hairlines. Nothing animates in except the loading spinner."
      title="Feedback"
    >
      <BlockGrid>
        <AlertBlock />
        <ToastBlock />
        <ProgressBlock />
        <SpinnerBlock />
        <SkeletonBlock />
        <EmptyBlock />
      </BlockGrid>
    </Section>
  );
}
