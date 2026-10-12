import { cn } from "@rulisme/ui/lib/utils";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { Band, Rail } from "@rulisme/ui/ui/rails";
import { Languages } from "lucide-react";
import { localePath, otherLocale, useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";

const NAV_LINK_CLASS = buttonVariants({ variant: "ghost", size: "sm" });

/**
 * The 56px nav band at column width (DESIGN.md § Components › Nav): the
 * wordmark, the in-page anchors and the language switch as ghost buttons,
 * then the pale-blue news bar. The nav band opens the page, so its column
 * has no rule above it to mark with diamonds.
 */
export function HubHeader({ allToolsLive }: { allToolsLive: boolean }) {
  const { locale, t } = useTranslation();
  const switchTo = otherLocale(locale);

  return (
    <header>
      <Band>
        <Rail
          className="flex h-14 items-center gap-1 px-3 sm:px-4"
          nodes={false}
        >
          <a
            className="type-title mr-3 flex shrink-0 items-center gap-2 text-foreground"
            href={localePath(locale)}
          >
            <BrandMark />
            pilihpendidikan
          </a>
          <nav
            aria-label={t("nav.sections")}
            className="hidden items-center gap-0.5 md:flex"
          >
            <a className={NAV_LINK_CLASS} href="#tools">
              {t("tools.heading")}
            </a>
            <a className={NAV_LINK_CLASS} href="#mcp">
              {t("services.mcp.heading")}
            </a>
          </nav>
          <a
            className={cn(NAV_LINK_CLASS, "ml-auto")}
            href={localePath(switchTo)}
            lang={switchTo}
          >
            <Languages aria-hidden="true" data-icon="inline-start" />
            {t("nav.switchLanguage")}
          </a>
        </Rail>
      </Band>
      <Band className="bg-wash">
        <Rail className="px-3 py-2 sm:px-4">
          <p className="type-caption text-pretty text-foreground">
            {allToolsLive ? (
              <>
                <span className="weight-semibold">{t("news.label")}</span>{" "}
                {t("news.live")}
              </>
            ) : (
              t("news.audience")
            )}
          </p>
        </Rail>
      </Band>
    </header>
  );
}
