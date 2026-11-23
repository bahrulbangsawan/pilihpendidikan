import { cn } from "@rulisme/ui/lib/utils";
import { useActiveSection } from "./active-section";
import { NAV_GROUPS } from "./nav";

/**
 * The left nav of cursor.com/docs in dark: a 308px column on the card colour
 * ruled off by a 10% border, 12px muted group labels, 30px body-role rows
 * that fill with `pane` on hover, and the current section in orange with no
 * fill. It sticks under the 49px header from `lg`.
 */
export function SiteNav() {
  const active = useActiveSection();
  return (
    <aside className="sticky top-12.25 hidden h-[calc(100svh-49px)] w-77 shrink-0 overflow-y-auto border-border border-r bg-sidebar lg:block">
      <nav aria-label="Sections" className="flex flex-col gap-7 px-4 py-8">
        {NAV_GROUPS.map((group) => (
          <div className="flex flex-col gap-1" key={group.id}>
            <p className="type-caption px-2 pb-1 text-muted-foreground">
              {group.label}
            </p>
            <ul className="flex flex-col">
              {group.sections.map((section) => {
                const current = section.id === active;
                return (
                  <li key={section.id}>
                    <a
                      aria-current={current ? "location" : undefined}
                      className={cn(
                        "type-body flex h-7.5 items-center rounded-sm px-2 transition-[background-color,color] duration-140 ease-standard hover:bg-pane/70",
                        current ? "text-link" : "text-foreground"
                      )}
                      href={`#${section.id}`}
                    >
                      {section.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
