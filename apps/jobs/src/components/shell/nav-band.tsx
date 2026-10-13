// The nav band of 12 §2.1 (56px). On desktop the wordmark cell is exactly as
// wide as the sidebar below it and shares its right rule, with a diamond
// node where that rule crosses the band's bottom rule. Then the ⌘K search
// and the one blue button of the nav, New with `N`. The sections live in the
// sidebar only.

import { Diamond } from "@rulisme/ui/ui/rails";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd, KbdGroup } from "@rulisme/ui/ui/kbd";
import { Menu, Plus, Search } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";

/** Sidebar width; the nav band's wordmark cell matches it. */
export const SIDEBAR_WIDTH_CLASS = "w-60";

export function NavBand({
  onMenu,
  onNew,
  onPalette,
}: {
  onMenu: () => void;
  onNew: () => void;
  onPalette: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="band sticky top-0 z-30 bg-background">
      <div className="flex h-14 items-stretch">
        <div
          className={`relative flex shrink-0 items-center gap-1 px-3 md:border-line md:border-r md:px-5 ${SIDEBAR_WIDTH_CLASS} max-md:w-auto`}
        >
          <Button
            aria-label={t("nav.openMenu")}
            className="md:hidden"
            onClick={onMenu}
            size="icon-sm"
            variant="ghost"
          >
            <Menu aria-hidden="true" />
          </Button>
          <AppLink
            aria-label={t("nav.home")}
            className="rounded-md px-1 py-1"
            href="/board"
          >
            <BrandMark label={t("app.name")} />
          </AppLink>
          <Diamond className="-right-[calc(var(--node)/2+0.5px)] -bottom-[calc(var(--node)/2+0.5px)] max-md:hidden" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4 sm:px-6">
          <Button
            aria-keyshortcuts="Meta+K Control+K"
            className="w-full max-w-72 justify-start text-muted-foreground max-sm:hidden"
            onClick={onPalette}
            size="sm"
            variant="outline"
          >
            <Search aria-hidden="true" data-icon="inline-start" />
            <span className="flex-1 text-left">{t("nav.search")}</span>
            <KbdGroup aria-hidden="true">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              aria-label={t("nav.search")}
              className="sm:hidden"
              onClick={onPalette}
              size="icon-sm"
              variant="ghost"
            >
              <Search aria-hidden="true" />
            </Button>
            <Button aria-keyshortcuts="N" onClick={onNew} size="sm">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t("nav.new")}
              <Kbd aria-hidden="true">N</Kbd>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
