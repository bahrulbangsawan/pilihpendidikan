import { Rail } from "@rulisme/ui/ui/rails";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { localePath, otherLocale, useTranslation } from "@/i18n";

// Footer links: underlined, the underline colour is what animates on hover
// (DESIGN.md § Motion). The default focus ring is cobalt, invisible on the
// cobalt slab, so it turns white here.
const LINK_CLASS =
  "type-body inline-flex items-center gap-1 underline decoration-primary-foreground/40 underline-offset-4 transition-[text-decoration-color] hover:decoration-primary-foreground focus-visible:outline-primary-foreground";

function FooterColumn({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="type-body weight-semibold text-primary-foreground">
        {heading}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}

/**
 * The footer slab (DESIGN.md § Components › Footer, § Do's: "keep the blue
 * scarce above the footer, then flood the footer with it"): the brand blurb
 * and four link columns on the ruled column, then a hatched band carrying the
 * wordmark in outline. Secondary text stays at 80% of the foreground or more
 * (DESIGN.md § Measured contrast). Nothing here links to a builder or the api
 * host: each live service is linked once, from its own cell.
 */
export function HubFooter() {
  const { locale, t } = useTranslation();
  const switchTo = otherLocale(locale);

  return (
    <footer className="bg-primary text-primary-foreground">
      <Rail
        className="grid grid-cols-2 gap-x-6 gap-y-10 border-primary-foreground/25 px-5 py-12 sm:px-10 md:grid-cols-[2fr_repeat(4,1fr)] md:gap-x-8"
        nodes={false}
      >
        <div className="col-span-2 flex max-w-xs flex-col gap-2 md:col-span-1">
          <p className="type-title">{t("meta.siteName")}</p>
          <p className="type-body text-primary-foreground/80">
            {t("footer.blurb")}
          </p>
        </div>
        <FooterColumn heading={t("footer.onThisPage")}>
          <li>
            <a className={LINK_CLASS} href="#tools">
              {t("tools.heading")}
            </a>
          </li>
          <li>
            <a className={LINK_CLASS} href="#mcp">
              {t("services.mcp.heading")}
            </a>
          </li>
        </FooterColumn>
        <FooterColumn heading={t("footer.builtBy")}>
          <li>
            <a className={LINK_CLASS} href="https://bahrul.me">
              Bahrul Bangsawan
              <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
            </a>
          </li>
        </FooterColumn>
        <FooterColumn heading={t("footer.language")}>
          <li>
            <a
              className={LINK_CLASS}
              href={localePath(switchTo)}
              lang={switchTo}
            >
              {t("nav.switchLanguage")}
            </a>
          </li>
        </FooterColumn>
        <FooterColumn heading={t("footer.agents")}>
          <li>
            <a className={LINK_CLASS} href="/llms.txt">
              llms.txt
            </a>
          </li>
        </FooterColumn>
      </Rail>
      <div className="hatch overflow-hidden border-primary-foreground/25 border-t">
        {/* The viewBox fits the glyphs (about 813 × 105 at this size, the
            baseline at y=100) with ~17 units of air above and below. */}
        <svg
          aria-hidden="true"
          className="rail block h-20 border-primary-foreground/25 sm:h-32"
          preserveAspectRatio="xMidYMid meet"
          viewBox="0 0 860 140"
        >
          {/* The variable font's overlapping contours would show through a
              bare outline; painting the stroke first under a cobalt fill hides
              them, so only the glyphs' outer edge shows (hence 2.5 for a
              1.25-unit line). */}
          <text
            className="weight-bold fill-primary italic [paint-order:stroke]"
            fontSize="112"
            stroke="currentColor"
            strokeWidth="2.5"
            textAnchor="middle"
            x="430"
            y="100"
          >
            pilihpendidikan
          </text>
        </svg>
      </div>
    </footer>
  );
}
