import { ArrowUpRight } from "lucide-react";
import { Wordmark } from "./site-header";

const COLUMNS = [
  {
    heading: "System",
    links: [
      { label: "Foundations", href: "#foundations" },
      { label: "Components", href: "#actions" },
      { label: "Do and don't", href: "#dos-and-donts" },
      { label: "Recipes", href: "#recipes" },
      { label: "Example screen", href: "#example-screen" },
    ],
  },
  {
    heading: "Builders",
    links: [
      { label: "CV", href: "https://cv.pilihpendidikan.com" },
      { label: "Invoice", href: "https://invoice.pilihpendidikan.com" },
      { label: "Portfolio", href: "https://portfolio.pilihpendidikan.com" },
    ],
  },
  {
    heading: "Workspace",
    links: [
      { label: "pilihpendidikan.com", href: "https://pilihpendidikan.com" },
      { label: "Zedative flavor", href: "https://flavors.design/f/zedative" },
    ],
  },
] as const;

/**
 * The cursor.com footer in dark: a 10% rule, the wordmark with one muted
 * line, then columns of muted body-role links that turn `foreground` on
 * hover, ↗ on external ones.
 */
export function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-10 md:grid-cols-[2fr_1fr_1fr_1fr] xl:px-16">
        <div className="flex max-w-xs flex-col gap-3">
          <Wordmark />
          <p className="type-body text-muted-foreground">
            The pilihpendidikan design system: a warm near-black page, one
            family at weight 400, flat cards, pill buttons and an orange kept
            for links.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div className="flex flex-col gap-3" key={column.heading}>
            <p className="type-body text-foreground">{column.heading}</p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => {
                const external = link.href.startsWith("http");
                return (
                  <li key={link.label}>
                    <a
                      className="type-body inline-flex items-center gap-1 text-muted-foreground transition-[color] duration-140 ease-standard hover:text-foreground"
                      href={link.href}
                      rel={external ? "noopener" : undefined}
                      target={external ? "_blank" : undefined}
                    >
                      {link.label}
                      {external ? (
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-6xl px-5 pb-10 sm:px-10 xl:px-16">
        <p className="type-caption text-muted-foreground">
          © pilihpendidikan · Zedative renders @rulisme/ui from source.
        </p>
      </div>
    </footer>
  );
}
