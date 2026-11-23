// The sidebar (reui app-shell): on the card colour with a right rule. A brand
// row (20px mark, "Pilih Jobs", the collapse toggle), a search field that
// opens the ⌘K palette, the work group under a grey label (Board, Stats),
// then at the bottom the account group (Profile, Settings) and the user
// footer that opens the profile dropdown. 32px rows at 4px radius fill with
// `pane` on hover; the current page sits on `pane-2` in the foreground.
// Collapsed, it is a 56px rail of icons. Phones open it in a Sheet.

import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { useRouterState } from "@tanstack/react-router";
import { PanelLeft, Search } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";
import type { NavItem } from "./nav-items";
import { isCurrent, NAV_GROUPS } from "./nav-items";
import { UserMenu } from "./user-menu";

/** Sidebar widths: open and collapsed to a rail. */
export const SIDEBAR_WIDTH_CLASS = "w-60";
export const SIDEBAR_RAIL_CLASS = "w-14";

const ROW =
  "group/row flex h-8 items-center gap-2.5 rounded-md px-2 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0";

function NavRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const current = isCurrent(pathname, item);
  const Icon = item.icon;
  const label = t(`nav.${item.key}`);
  const link = (
    <AppLink
      aria-current={current ? "page" : undefined}
      aria-keyshortcuts={item.shortcut}
      aria-label={collapsed ? label : undefined}
      className={cn(
        ROW,
        "type-body",
        collapsed && "justify-center px-0",
        current
          ? "bg-pane-2 text-foreground"
          : "text-ink-sec hover:bg-pane hover:text-foreground"
      )}
      href={item.href}
      onClick={onNavigate}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          current ? "text-foreground" : "text-muted-foreground"
        )}
      />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {item.shortcut ? (
            <Kbd
              aria-hidden="true"
              className="opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
            >
              {item.shortcut}
            </Kbd>
          ) : null}
        </>
      )}
    </AppLink>
  );
  return (
    <li>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

function NavGroupList({
  groupKey,
  collapsed,
  onNavigate,
  showLabel,
}: {
  groupKey: string;
  collapsed: boolean;
  onNavigate?: () => void;
  showLabel: boolean;
}) {
  const { t } = useTranslation();
  const group = NAV_GROUPS.find((entry) => entry.key === groupKey);
  if (!group) {
    return null;
  }
  const labelId = `nav-group-${group.key}`;
  return (
    <section
      aria-label={showLabel ? undefined : t(`nav.group.${group.key}`)}
      aria-labelledby={showLabel ? labelId : undefined}
      className="flex flex-col"
    >
      {showLabel && !collapsed ? (
        <h2
          className="type-caption px-2 pb-1.5 text-muted-foreground"
          id={labelId}
        >
          {t(`nav.group.${group.key}`)}
        </h2>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <NavRow
            collapsed={collapsed}
            item={item}
            key={item.key}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </section>
  );
}

function SearchField({
  collapsed,
  onPalette,
}: {
  collapsed: boolean;
  onPalette: () => void;
}) {
  const { t } = useTranslation();
  if (collapsed) {
    return (
      <Button
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={t("nav.search")}
        className="self-center"
        onClick={onPalette}
        size="icon-sm"
        variant="ghost"
      >
        <Search aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Button
      aria-keyshortcuts="Meta+K Control+K"
      className="h-8 w-full justify-start gap-2 rounded-md border-border bg-background px-2.5 text-muted-foreground hover:border-input hover:bg-background hover:text-foreground has-[>[data-slot=kbd]]:pr-1.5"
      onClick={onPalette}
      variant="outline"
    >
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left">{t("nav.searchField")}</span>
      <Kbd aria-hidden="true">⌘K</Kbd>
    </Button>
  );
}

export function SidebarNav({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
  onPalette,
}: {
  collapsed?: boolean;
  /** Shows the collapse toggle (desktop only). */
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  onPalette: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 py-3">
      <div
        className={cn(
          "flex h-8 items-center gap-1",
          collapsed ? "flex-col justify-center px-2" : "px-3"
        )}
      >
        {collapsed ? null : (
          <AppLink
            aria-label={t("nav.home")}
            className="min-w-0 flex-1 rounded-sm px-1 py-1 outline-none focus-visible:outline-2 focus-visible:outline-ring"
            href="/board"
            onClick={onNavigate}
          >
            <BrandMark label={t("app.name")} />
          </AppLink>
        )}
        {onToggleCollapsed ? (
          <Button
            aria-expanded={!collapsed}
            aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
            onClick={onToggleCollapsed}
            size="icon-sm"
            variant="ghost"
          >
            <PanelLeft aria-hidden="true" className="text-muted-foreground" />
          </Button>
        ) : null}
      </div>
      <div className={cn("flex flex-col", collapsed ? "px-2" : "px-3")}>
        <SearchField
          collapsed={collapsed}
          onPalette={() => {
            onNavigate?.();
            onPalette();
          }}
        />
      </div>
      <nav
        aria-label={t("nav.sidebar")}
        className={cn(
          "flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto pt-2",
          collapsed ? "px-2" : "px-3"
        )}
      >
        <NavGroupList
          collapsed={collapsed}
          groupKey="track"
          onNavigate={onNavigate}
          showLabel
        />
        <NavGroupList
          collapsed={collapsed}
          groupKey="account"
          onNavigate={onNavigate}
          showLabel={false}
        />
      </nav>
      <div
        className={cn(
          "border-border border-t pt-2",
          collapsed ? "mx-2" : "mx-3"
        )}
      >
        <UserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
