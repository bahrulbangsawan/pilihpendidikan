// The nav band of 12 §2.1 (56px): wordmark, primary links, ⌘K search, the
// device status chip and the one blue button of the nav, New with `N`.

import { Button } from "@rulisme/ui/ui/button";
import { Kbd, KbdGroup } from "@rulisme/ui/ui/kbd";
import { useRouterState } from "@tanstack/react-router";
import { Menu, Plus, Search } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useDevices } from "@/hooks/use-devices";
import { useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";
import { BAND_LINKS, isCurrent } from "./nav-items";

function DeviceChip() {
  const { t } = useTranslation();
  const { online, isSuccess } = useDevices();
  if (!isSuccess) {
    return null;
  }
  const label =
    online === 0
      ? t("nav.devicesNone")
      : t(online === 1 ? "nav.devicesOne" : "nav.devicesMany", {
          count: online,
        });
  return (
    <AppLink
      className="type-caption hidden items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-pane/70 hover:text-foreground lg:inline-flex"
      href="/cli"
    >
      <span
        aria-hidden="true"
        className={
          online > 0
            ? "pulse-dot size-2 rounded-full bg-foreground"
            : "size-2 rounded-full border border-muted-foreground"
        }
      />
      {label}
    </AppLink>
  );
}

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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <header className="band sticky top-0 z-30 bg-background">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-5">
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
          className="mr-3 rounded-md"
          href="/board"
        >
          <BrandMark label={t("app.name")} />
        </AppLink>
        <nav
          aria-label={t("nav.primary")}
          className="hidden items-center gap-0.5 md:flex"
        >
          {BAND_LINKS.map((link) => {
            const current = isCurrent(pathname, link);
            return (
              <Button
                aria-current={current ? "page" : undefined}
                asChild
                className={current ? "weight-semibold" : undefined}
                key={link.key}
                size="sm"
                variant="ghost"
              >
                <AppLink href={link.href}>{t(`nav.${link.key}`)}</AppLink>
              </Button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button
            aria-keyshortcuts="Meta+K Control+K"
            className="text-muted-foreground max-sm:hidden"
            onClick={onPalette}
            size="sm"
            variant="outline"
          >
            <Search aria-hidden="true" data-icon="inline-start" />
            {t("nav.search")}
            <KbdGroup aria-hidden="true">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Button>
          <Button
            aria-label={t("nav.search")}
            className="sm:hidden"
            onClick={onPalette}
            size="icon-sm"
            variant="ghost"
          >
            <Search aria-hidden="true" />
          </Button>
          <DeviceChip />
          <Button aria-keyshortcuts="N" onClick={onNew} size="sm">
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t("nav.new")}
            <Kbd aria-hidden="true">N</Kbd>
          </Button>
        </div>
      </div>
    </header>
  );
}
