import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Button } from "@rulisme/ui/ui/button";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Moon, Sun } from "lucide-react";
import { useScheme } from "./theme";

export const SECTIONS = [
  { id: "foundations", label: "Foundations" },
  { id: "actions", label: "Actions" },
  { id: "inputs", label: "Inputs" },
  { id: "navigation", label: "Navigation" },
  { id: "data-display", label: "Data" },
  { id: "feedback", label: "Feedback" },
  { id: "overlays", label: "Overlays" },
  { id: "conversation", label: "Conversation" },
  { id: "dos-and-donts", label: "Do & don't" },
  { id: "recipes", label: "Recipes" },
] as const;

function Wordmark() {
  return (
    <a
      className="type-title flex shrink-0 items-center gap-2 text-foreground"
      href="#overview"
    >
      <span
        aria-hidden="true"
        className="grid size-5 place-items-center rounded-sm bg-primary"
      >
        <span className="size-2 rotate-45 border border-primary-foreground" />
      </span>
      Zedative
    </a>
  );
}

function ThemeToggle() {
  const { scheme, setScheme } = useScheme();
  const dark = scheme === "dark";
  const toggle = () => setScheme(dark ? "light" : "dark");
  useShortcut("t", toggle);
  return (
    <Button
      aria-label={dark ? "Switch to light (T)" : "Switch to Night Desk (T)"}
      onClick={toggle}
      size="icon-sm"
      title={dark ? "Light (T)" : "Night Desk (T)"}
      variant="ghost"
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}

/**
 * The 56px nav band at column width (DESIGN.md § Components › Nav): wordmark,
 * section links as ghost buttons, the theme toggle and one cobalt action
 * with its shortcut. A pale-blue news bar sits under it.
 */
export function SiteHeader() {
  useShortcut("c", () => {
    window.location.hash = "actions";
  });
  return (
    <header className="sticky top-0 z-40 bg-background">
      <div className="band">
        <div className="rail flex h-14 items-center gap-3 px-3 sm:px-4">
          <Wordmark />
          <nav
            aria-label="Sections"
            className="no-scrollbar ml-2 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex"
          >
            {SECTIONS.map((section) => (
              <a
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                href={`#${section.id}`}
                key={section.id}
              >
                {section.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {/* Through Button so the link carries data-slot="button" and
                data-variant: the Kbd keys its white cap on them. */}
            <Button asChild size="sm">
              <a href="#actions">
                Components
                <Kbd>C</Kbd>
              </a>
            </Button>
          </div>
        </div>
      </div>
      <div className="band bg-wash">
        <p className="rail type-caption px-3 py-2 text-foreground sm:px-4">
          <span className="weight-semibold">News:</span> pilihpendidikan now
          runs on Zedative, from the hub to the CV, invoice and portfolio
          builders.
        </p>
      </div>
    </header>
  );
}
