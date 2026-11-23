// The nav band of 12 §2.1, drawn like cursor.com/docs' header: 49px on the
// page colour with one bottom rule, the wordmark in a cell as wide as the
// sidebar below it, the ⌘K search box centred (36px, 8px radius, the ⌘K
// chip) and the one primary pill of the nav, New with `N`. The sections
// live in the sidebar only.

import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Menu, Plus, Search } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";

/** Sidebar width; the nav band's wordmark cell matches it. */
export const SIDEBAR_WIDTH_CLASS = "w-64";

/** Height of the nav band, its bottom rule included (cursor.com: 49px). */
export const NAV_HEIGHT_CLASS = "h-[49px]";

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
    <header
      className={`sticky top-0 z-30 border-border border-b bg-background ${NAV_HEIGHT_CLASS}`}
    >
      <div className="flex h-12 items-center">
        <div
          className={`flex shrink-0 items-center gap-1 px-3 md:px-6 ${SIDEBAR_WIDTH_CLASS} max-md:w-auto`}
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
            className="rounded-sm py-1"
            href="/board"
          >
            <BrandMark label={t("app.name")} />
          </AppLink>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 justify-center max-sm:hidden">
            <button
              aria-keyshortcuts="Meta+K Control+K"
              className="type-body flex h-9 w-full max-w-80 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground outline-none transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0"
              onClick={onPalette}
              type="button"
            >
              <Search aria-hidden="true" className="size-4 shrink-0" />
              <span className="flex-1 truncate text-left">
                {t("nav.search")}
              </span>
              <Kbd aria-hidden="true">⌘K</Kbd>
            </button>
          </div>
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
            <Button aria-keyshortcuts="N" onClick={onNew}>
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
