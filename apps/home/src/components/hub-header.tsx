import { cn } from "@rulisme/ui/lib/utils";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { localePath, otherLocale, useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";

// cursor.com's header nav links: 14px, 5.6px × 15px padding, no fill; the
// colour dims on hover.
const NAV_LINK_CLASS =
  "type-body rounded-full px-[15px] py-[5.6px] text-foreground transition-colors duration-140 ease-standard hover:text-ink-sec";

/**
 * The 52px header, fixed like cursor.com's: the mark and wordmark on the
 * left, the in-page anchors centred, the language switch as a plain link and
 * the primary action as the small light pill on the right.
 */
export function HubHeader() {
  const { locale, t } = useTranslation();
  const switchTo = otherLocale(locale);

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-background px-5">
      <div className="mx-auto flex h-[52px] max-w-rail items-center justify-between gap-4">
        <a
          aria-label={t("nav.home")}
          className="type-subtitle flex shrink-0 items-center gap-2 text-foreground"
          href={localePath(locale)}
        >
          <BrandMark />
          pilihpendidikan
        </a>
        <nav
          aria-label={t("nav.sections")}
          className="absolute left-1/2 hidden -translate-x-1/2 items-center md:flex"
        >
          <a className={NAV_LINK_CLASS} href={`${localePath(locale)}#tools`}>
            {t("nav.builders")}
          </a>
          <a className={NAV_LINK_CLASS} href={`${localePath(locale)}#mcp`}>
            {t("nav.assistants")}
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            className="type-body rounded-sm p-1 text-foreground transition-colors duration-140 ease-standard hover:text-ink-sec"
            href={localePath(switchTo)}
            lang={switchTo}
          >
            {t("nav.switchLanguage")}
          </a>
          <a
            className={cn(
              buttonVariants({ size: "sm" }),
              "hidden h-[27px] sm:inline-flex"
            )}
            href={`${localePath(locale)}#tools`}
          >
            {t("nav.builders")}
          </a>
        </div>
      </div>
    </header>
  );
}
