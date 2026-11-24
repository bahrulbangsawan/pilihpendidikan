import { cn } from "@rulisme/ui/lib/utils";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { Button } from "@rulisme/ui/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@rulisme/ui/ui/sheet";
import { Menu } from "lucide-react";
import { localePath, otherLocale, useTranslation } from "@/i18n";

const MENU_LINKS = [
  { key: "nav.builders", hash: "#tools" },
  { key: "nav.features", hash: "#why" },
  { key: "nav.exports", hash: "#exports" },
  { key: "nav.assistants", hash: "#mcp" },
  { key: "nav.crawler", hash: "" },
] as const;
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
          <a className={NAV_LINK_CLASS} href={`${localePath(locale)}#why`}>
            {t("nav.features")}
          </a>
          <a className={NAV_LINK_CLASS} href={`${localePath(locale)}#exports`}>
            {t("nav.exports")}
          </a>
          <a className={NAV_LINK_CLASS} href="/bot">
            {t("nav.crawler")}
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            className="type-body hidden rounded-sm p-1 text-foreground transition-colors duration-140 ease-standard hover:text-ink-sec sm:inline"
            href={localePath(switchTo)}
            lang={switchTo}
          >
            {t("nav.switchLanguage")}
          </a>
          <a
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "hidden h-[27px] lg:inline-flex"
            )}
            href={`${localePath(locale)}#mcp`}
          >
            {t("nav.assistants")}
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
          <Sheet>
            <SheetTrigger asChild>
              <Button
                aria-label={t("nav.menu")}
                className="md:hidden"
                size="icon-sm"
                variant="ghost"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent closeLabel={t("nav.menu")} floating side="right">
              <SheetHeader>
                <SheetTitle>{t("nav.menuTitle")}</SheetTitle>
              </SheetHeader>
              <nav
                aria-label={t("nav.sections")}
                className="flex flex-col px-4 pb-4"
              >
                {MENU_LINKS.map(({ hash, key }) => (
                  <SheetClose asChild key={key}>
                    <a
                      className="type-subtitle rounded-md px-2 py-2 text-foreground transition-colors duration-140 ease-standard hover:bg-pane"
                      href={hash ? `${localePath(locale)}${hash}` : "/bot"}
                    >
                      {t(key)}
                    </a>
                  </SheetClose>
                ))}
                <a
                  className="type-subtitle mt-2 rounded-md border-border border-t px-2 pt-4 pb-2 text-foreground transition-colors duration-140 ease-standard hover:bg-pane"
                  href={localePath(switchTo)}
                  lang={switchTo}
                >
                  {t("nav.switchLanguage")}
                </a>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
