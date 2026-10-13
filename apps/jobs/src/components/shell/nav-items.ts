// The navigation of 12 §2.1: primary links in the nav band, the full list in
// the sidebar, with single-key shortcuts (12 §2.2) and sidebar counters.

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
  /** Shown in the nav band on wide screens. */
  primary?: boolean;
  /** Paths that also mark this item as current. */
  prefix?: string;
  shortcut?: string;
}

export const MAIN_NAV: readonly NavItem[] = [
  {
    key: "board",
    href: "/board",
    icon: Kanban,
    shortcut: "B",
    primary: true,
    prefix: "/applications",
  },
  {
    key: "inbox",
    href: "/inbox",
    icon: Inbox,
    shortcut: "I",
    count: "inbox_new",
    primary: true,
    prefix: "/jobs",
  },
  {
    key: "approvals",
    href: "/automation",
    icon: CircleCheck,
    shortcut: "A",
    count: "approvals_pending",
  },
  {
    key: "runs",
    href: "/automation/runs",
    icon: ListChecks,
    shortcut: "R",
    count: "tasks_live",
  },
  { key: "sources", href: "/sources", icon: Rss },
  { key: "stats", href: "/stats", icon: BarChart3, primary: true },
];

export const ACCOUNT_NAV: readonly NavItem[] = [
  { key: "cli", href: "/cli", icon: Terminal },
  { key: "profile", href: "/profile", icon: UserRound },
  { key: "settings", href: "/settings", icon: Settings },
];

/** The nav band's links: Board, Inbox, Automation, Stats (12 §2.1). */
export const BAND_LINKS: readonly {
  key: string;
  href: string;
  prefix: string;
}[] = [
  { key: "board", href: "/board", prefix: "/applications" },
  { key: "inbox", href: "/inbox", prefix: "/jobs" },
  { key: "automation", href: "/automation", prefix: "/automation" },
  { key: "stats", href: "/stats", prefix: "/stats" },
];

export function isCurrent(
  pathname: string,
  item: Pick<NavItem, "href" | "prefix">
): boolean {
  if (item.href === "/automation" && item.prefix === undefined) {
    return pathname === "/automation" || pathname === "/automation/";
  }
  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.prefix !== undefined && pathname.startsWith(item.prefix))
  );
}
