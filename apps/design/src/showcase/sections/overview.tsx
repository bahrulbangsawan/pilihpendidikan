import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@rulisme/ui/ui/segmented-control";
import { BookOpen, Layers } from "lucide-react";
import { useActiveSection } from "../active-section";
import { groupOf, NAV_GROUPS } from "../nav";

/** Where each group of the hero's switch lands: its first section below the
 * hero (System's own first section is this intro, so it jumps on to
 * Foundations). */
const GROUP_TARGETS: Record<string, string> = {
  system: "foundations",
  components: "actions",
  guidance: "dos-and-donts",
};

const PRINCIPLES = [
  {
    title: "One family, weight 400",
    body: "Geist on cursor.com's type scale: eight roles from the 72px hero to the 11px micro, all at weight 400. Hierarchy comes from size, not bold.",
    href: "#foundations",
  },
  {
    title: "Flat, one step up",
    body: "Cards sit one step above the warm near-black page, #1b1913 on #14120b, with a 2.5% hairline and a 4px radius. No shadows on cards.",
    href: "#data-display",
  },
  {
    title: "Pills, and orange for links",
    body: "Buttons are pills: a light primary, a warm-grey secondary, a 20%-outlined ghost. Orange #f54e00 is kept for text links.",
    href: "#actions",
  },
] as const;

/**
 * The page intro, set like the top of cursor.com/pricing: a centred section
 * with the 52px hero-compact h1 (36px below lg), a centred lead, the light
 * primary pill and the filled secondary one with their shortcuts, and a
 * filled pill switch (System / Components / Guidance) that jumps to those
 * groups and follows the reader down the page; then three equal cards.
 * 52px over 36px: on cursor.com/pricing the h1 is the one big line of the
 * page, and here too nothing else on the page is larger than 36px, so the
 * hero keeps one clear step above every section title.
 */
export function OverviewSection() {
  const active = useActiveSection();
  const activeGroup = groupOf(active)?.id ?? "system";
  useShortcut("f", () => {
    window.location.hash = "foundations";
  });
  return (
    <section aria-labelledby="overview-title" className="band" id="overview">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-5 pt-16 pb-8 sm:px-10 sm:pt-20 xl:px-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <p className="type-body text-muted-foreground">
            System · shadcn/ui on @rulisme/ui
          </p>
          <h1
            className="type-headline lg:type-hero-compact text-balance text-foreground"
            id="overview-title"
          >
            Zedative design system
          </h1>
          <p className="type-subtitle text-pretty text-ink">
            The pilihpendidikan design system, rebuilt on cursor.com's dark
            theme: a warm near-black page, cards one step lighter, Geist at
            weight 400, pill buttons, and orange only where text links.
          </p>
          {/* Through Button so each link carries data-slot="button" and
              data-variant: the Kbd keys its cap on them. */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <Button asChild>
              <a href="#actions">
                <Layers aria-hidden="true" data-icon="inline-start" />
                Browse components
                <Kbd>C</Kbd>
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href="#foundations">
                <BookOpen aria-hidden="true" data-icon="inline-start" />
                Foundations
                <Kbd>F</Kbd>
              </a>
            </Button>
          </div>
          <SegmentedControl
            aria-label="Jump to a group"
            className="mt-4"
            onValueChange={(group) => {
              const target = GROUP_TARGETS[group];
              if (target) {
                window.location.hash = target;
              }
            }}
            value={activeGroup}
          >
            {NAV_GROUPS.map((group) => (
              <SegmentedControlItem key={group.id} value={group.id}>
                {group.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <p className="type-caption text-muted-foreground">
            Dark only: there is no light scheme and no theme switch. Press / to
            jump to any section.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((principle) => (
            <a
              className="flex flex-col gap-2 rounded-sm border border-hairline bg-card p-4.5 transition-[background-color] duration-140 ease-standard hover:bg-pane"
              href={principle.href}
              key={principle.title}
            >
              <h3 className="type-subtitle text-foreground">
                {principle.title}
              </h3>
              <p className="type-body text-muted-foreground">
                {principle.body}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
