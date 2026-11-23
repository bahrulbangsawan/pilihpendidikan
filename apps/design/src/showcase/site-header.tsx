import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@rulisme/ui/ui/command";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Search } from "lucide-react";
import { useState } from "react";
import { useActiveSection } from "./active-section";
import { groupOf, NAV_GROUPS } from "./nav";

/** The lettermark: a 20px light tile, like Cursor's mark beside its name. */
export function Wordmark() {
  return (
    <a
      className="type-subtitle flex shrink-0 items-center gap-2 text-foreground"
      href="#overview"
    >
      <span
        aria-hidden="true"
        className="type-caption grid size-5 place-items-center rounded-sm bg-primary text-primary-foreground"
      >
        Z
      </span>
      Zedative
    </a>
  );
}

/**
 * The docs search box (36px, 8px radius, 10% border) that opens a jump list
 * of every section. "/" opens it; ⌘K stays with the palette demo in
 * Overlays.
 */
function JumpSearch() {
  const [open, setOpen] = useState(false);
  useShortcut("/", () => setOpen(true));

  const jump = (id: string) => {
    setOpen(false);
    window.location.hash = id;
  };

  return (
    <>
      <button
        aria-keyshortcuts="/"
        className="type-body hidden h-9 w-80 items-center gap-2 rounded-lg border border-border bg-background pr-1.5 pl-3 text-muted-foreground outline-none transition-[border-color,color] duration-140 ease-standard hover:border-input hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid md:flex"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search aria-hidden="true" className="size-3.5" />
        <span className="flex-1 text-left">Search the system…</span>
        <Kbd>/</Kbd>
      </button>
      <CommandDialog
        description="Jump to a section of the design system page."
        onOpenChange={setOpen}
        open={open}
        title="Search the system"
      >
        <Command>
          <CommandInput placeholder="Jump to a section…" />
          <CommandList>
            <CommandEmpty>No section by that name.</CommandEmpty>
            {NAV_GROUPS.map((group) => (
              <CommandGroup heading={group.label} key={group.id}>
                {group.sections.map((section) => (
                  <CommandItem
                    key={section.id}
                    onSelect={() => jump(section.id)}
                  >
                    {section.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

/**
 * The 49px docs header (cursor.com/docs, dark): the wordmark over the nav
 * column, group tabs with an orange active tab underlined in orange, the
 * search box in the middle and two pills on the right.
 */
export function SiteHeader() {
  const active = useActiveSection();
  const activeGroup = groupOf(active)?.id;
  useShortcut("c", () => {
    window.location.hash = "actions";
  });

  return (
    <header className="sticky top-0 z-40 flex h-12.25 items-center border-border border-b bg-background">
      <div className="flex h-full shrink-0 items-center pr-6 pl-4 sm:pl-6">
        <Wordmark />
      </div>
      <nav
        aria-label="Parts of the system"
        className="hidden h-full items-stretch gap-1 md:flex"
      >
        {NAV_GROUPS.map((group) => {
          const current = group.id === activeGroup;
          return (
            <a
              aria-current={current ? "true" : undefined}
              className={cn(
                "type-body -mb-px flex items-center border-b-2 px-3 transition-[color,border-color] duration-140 ease-standard",
                current
                  ? "border-link text-link"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              href={`#${group.sections[0].id}`}
              key={group.id}
            >
              {group.label}
            </a>
          );
        })}
      </nav>
      <div className="flex flex-1 justify-center px-4">
        <JumpSearch />
      </div>
      <div className="flex shrink-0 items-center gap-2 pr-2 pl-4 sm:pr-3">
        <a
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "hidden sm:inline-flex"
          )}
          href="https://pilihpendidikan.com"
          rel="noopener"
          target="_blank"
        >
          pilihpendidikan.com
        </a>
        {/* Through Button so the link carries data-slot="button" and
            data-variant: the Kbd keys its cap on them. */}
        <Button asChild size="sm">
          <a href="#actions">
            Components
            <Kbd>C</Kbd>
          </a>
        </Button>
      </div>
    </header>
  );
}
