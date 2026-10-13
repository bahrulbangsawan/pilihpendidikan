// The sidebar of 12 §2.1: compact rows, counters in micro tabular figures,
// shortcut hints. Desktop shows it as a ruled column; phones open it in a
// Sheet from the nav band.

import type { BoardResponse } from "@pilihpendidikan/jobs-contracts/api";

type BoardCounts = BoardResponse["counts"];
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@rulisme/ui/ui/sidebar";
import { useRouterState } from "@tanstack/react-router";
import { AppLink } from "@/components/app-link";
import { useTranslation } from "@/i18n";
import type { NavItem } from "./nav-items";
import { ACCOUNT_NAV, isCurrent, MAIN_NAV } from "./nav-items";

function NavRow({
  item,
  counts,
  onNavigate,
}: {
  item: NavItem;
  counts: BoardCounts | null;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const current = isCurrent(pathname, item);
  const count = item.count && counts ? counts[item.count] : 0;
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={current}>
        <AppLink
          aria-current={current ? "page" : undefined}
          aria-keyshortcuts={item.shortcut}
          href={item.href}
          onClick={onNavigate}
        >
          <Icon aria-hidden="true" />
          <span className="flex-1 truncate">{t(`nav.${item.key}`)}</span>
          {item.shortcut ? (
            <Kbd aria-hidden="true" className="mr-6">
              {item.shortcut}
            </Kbd>
          ) : null}
        </AppLink>
      </SidebarMenuButton>
      {count > 0 ? (
        <SidebarMenuBadge>
          <span className="sr-only">{t("nav.countLabel", { count })}</span>
          <span aria-hidden="true">{count}</span>
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

export function SidebarNav({
  counts,
  onNavigate,
}: {
  counts: BoardCounts | null;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SidebarProvider className="h-full min-h-0">
      <Sidebar className="h-full w-full border-r-0" collapsible="none">
        <SidebarContent>
          <nav aria-label={t("nav.sidebar")}>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {MAIN_NAV.map((item) => (
                    <NavRow
                      counts={counts}
                      item={item}
                      key={item.key}
                      onNavigate={onNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {ACCOUNT_NAV.map((item) => (
                    <NavRow
                      counts={counts}
                      item={item}
                      key={item.key}
                      onNavigate={onNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
