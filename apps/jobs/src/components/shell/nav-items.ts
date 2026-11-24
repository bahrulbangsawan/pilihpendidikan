// The sidebar's sections (reui app-shell): the work group at the top (Board,
// Stats) and the account group at the bottom (Profile, Settings).

import type { LucideIcon } from "lucide-react";
import { ChartColumn, Kanban, Settings, UserRound } from "lucide-react";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  /** i18n key under `nav.` */
  key: string;
  /** Paths that also mark this item as current. */
  prefix?: string;
  shortcut?: string;
}

export interface NavGroup {
  items: readonly NavItem[];
  /** i18n key under `nav.group.` */
  key: string;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "track",
    items: [
      {
        key: "board",
        href: "/board",
        icon: Kanban,
        shortcut: "B",
        prefix: "/applications",
      },
      { key: "stats", href: "/stats", icon: ChartColumn },
    ],
  },
  {
    key: "account",
    items: [
      { key: "profile", href: "/profile", icon: UserRound },
      { key: "settings", href: "/settings", icon: Settings },
    ],
  },
];

export function isCurrent(
  pathname: string,
  item: Pick<NavItem, "href" | "prefix">
): boolean {
  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.prefix !== undefined && pathname.startsWith(item.prefix))
  );
}

/** Every section in sidebar order (the ⌘K palette and the tests). */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items
);
