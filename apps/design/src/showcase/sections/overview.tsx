import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Rail } from "@rulisme/ui/ui/rails";
import { BookOpen, Layers } from "lucide-react";

const PRINCIPLES = [
  {
    title: "One family",
    body: "Inter Variable in six roles and three weights, each weight paired with an optical size. No all-caps, no letter-spacing.",
  },
  {
    title: "Ruled, not raised",
    body: "Hairlines and diamond nodes do the work of shadows. Cards are square; only buttons and chips round their corners.",
  },
  {
    title: "One blue",
    body: "Cobalt marks the one action that matters in view, then floods the footer. Everything else is paper and ink.",
  },
] as const;

/**
 * The hero band (DESIGN.md § Layout): graph paper, the display role in
 * italic cobalt, a subtitle lead, a primary and a secondary action with their
 * shortcuts, then three butted cells.
 */
export function OverviewSection() {
  useShortcut("f", () => {
    window.location.hash = "foundations";
  });
  return (
    <section aria-labelledby="overview-title" id="overview">
      <div className="band graph-paper">
        <Rail className="flex flex-col items-start gap-6 px-5 pt-28 pb-12 sm:px-10">
          <p className="type-caption text-muted-foreground">
            Themed from DESIGN.md · shadcn/ui on @rulisme/ui
          </p>
          <h1
            className="type-display max-w-2xl text-primary italic"
            id="overview-title"
          >
            Drafting paper for documents that open doors.
          </h1>
          <p className="type-subtitle max-w-xl">
            Zedative is the pilihpendidikan design system: warm graph paper
            ruled into hairline rails, one family set in six roles, and a single
            cobalt for the action that matters.
          </p>
          {/* Through Button so each link carries data-slot="button" and
              data-variant: the Kbd keys its white cap on them. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <a href="#actions">
                <Layers aria-hidden="true" data-icon="inline-start" />
                Browse components
                <Kbd>C</Kbd>
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="#foundations">
                <BookOpen aria-hidden="true" data-icon="inline-start" />
                Foundations
                <Kbd>F</Kbd>
              </a>
            </Button>
          </div>
          <p className="type-caption text-muted-foreground">
            Light by default. Press T for Night Desk.
          </p>
        </Rail>
      </div>
      <div className="band">
        <Rail className="grid md:grid-cols-3">
          {PRINCIPLES.map((principle) => (
            <div
              className="flex flex-col gap-1.5 border-line border-b px-5 py-8 last:border-b-0 sm:px-10 md:border-r md:border-b-0 md:last:border-r-0"
              key={principle.title}
            >
              <h3 className="type-subtitle weight-semibold">
                {principle.title}
              </h3>
              <p className="type-body">{principle.body}</p>
            </div>
          ))}
        </Rail>
      </div>
    </section>
  );
}
