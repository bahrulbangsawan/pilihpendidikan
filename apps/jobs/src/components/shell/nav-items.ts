// The navigation of 12 §2.1: every section lives in the sidebar, grouped by
// what the user is doing, with single-key shortcuts (12 §2.2) and counters.

import type { BoardResponse } from "@pilihpendidikan/jobs-contracts/api";

type BoardCounts = BoardResponse["counts"];
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CircleCheck,
  Inbox,
  Kanban,
  ListChecks,
  Rss,
  Settings,
  Terminal,
  UserRound,
} from "lucide-react";

export interface NavItem {
  /** BoardCounts field shown as the sidebar counter. */
  count?: keyof BoardCounts;
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
      {
        key: "inbox",
        href: "/inbox",
        icon: Inbox,
        shortcut: "I",
        count: "inbox_new",
        prefix: "/jobs",
      },
      { key: "stats", href: "/stats", icon: BarChart3 },
    ],
  },
  {
    key: "automate",
    items: [
      {
        key: "approvals",
        href: "/automation",
        icon: CircleCheck,
        shortcut: "A",
        count: "approvals_pending",
        prefix: "/automation/rules",
      },
      {
        key: "runs",
        href: "/automation/runs",
        icon: ListChecks,
        shortcut: "R",
        count: "tasks_live",
      },
      { key: "sources", href: "/sources", icon: Rss },
    ],
  },
  {
    key: "setup",
    items: [
      { key: "cli", href: "/cli", icon: Terminal },
      { key: "profile", href: "/profile", icon: UserRound },
      { key: "settings", href: "/settings", icon: Settings },
    ],
  },
];

export function isCurrent(
  pathname: string,
  item: Pick<NavItem, "href" | "prefix">
): boolean {
  if (item.href === "/automation") {
    return (
      pathname === "/automation" ||
      pathname === "/automation/" ||
      (item.prefix !== undefined && pathname.startsWith(item.prefix))
    );
  }
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
