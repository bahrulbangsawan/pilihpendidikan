import { ArrowUpRight } from "lucide-react";

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
 * The footer slab (DESIGN.md § Components › Footer): the blue floods the
 * band, column heads in the heading weight, underlined links with ↗ for
 * external ones, then a hatched band carrying the wordmark in outline.
 */
export function SiteFooter() {
  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="rail grid gap-10 border-primary-foreground/25 px-5 py-12 sm:px-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex max-w-xs flex-col gap-2">
          <p className="type-title">Zedative</p>
          <p className="type-body text-primary-foreground/80">
            The pilihpendidikan design system. Graph paper, hairline rails, one
            family and one blue.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div className="flex flex-col gap-3" key={column.heading}>
            <p className="type-body weight-semibold">{column.heading}</p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => {
                const external = link.href.startsWith("http");
                return (
                  <li key={link.label}>
                    <a
                      className="type-body inline-flex items-center gap-1 underline decoration-primary-foreground/40 underline-offset-4 transition-[text-decoration-color] hover:decoration-primary-foreground"
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
      <div
        aria-hidden="true"
        className="hatch overflow-hidden border-primary-foreground/25 border-t"
      >
        <svg
          className="rail block h-24 w-full border-primary-foreground/25 sm:h-36"
          preserveAspectRatio="xMidYMid meet"
          viewBox="0 0 600 120"
        >
          {/* Inter Variable's glyphs overlap their own contours, which an
              unfilled stroke shows at every join. Painting the stroke first
              and filling with the slab's cobalt hides the inner half of the
              (doubled) stroke and the overlaps, leaving a clean outline. */}
          <text
            className="fill-primary [paint-order:stroke]"
            dominantBaseline="middle"
            fontFamily="Inter Variable, sans-serif"
            fontSize="112"
            fontStyle="italic"
            fontWeight="700"
            stroke="currentColor"
            strokeWidth="2.5"
            textAnchor="middle"
            x="300"
            y="62"
          >
            Zedative
          </text>
        </svg>
      </div>
    </footer>
  );
}
