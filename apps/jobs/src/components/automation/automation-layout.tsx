// /automation (12 §6): a header band with the three tabs — Approvals (the
// default), Rules, Runs — as links, so each tab has its own URL and the B /
// I / A / R shortcuts land on the right one. Counts piggyback on the board
// poll the shell already runs (12 §10).

import { cn } from "@rulisme/ui/lib/utils";
import {
  tabsListVariants,
  tabsTriggerVariants,
} from "@rulisme/ui/ui/tabs-variants";
import { Link, Outlet } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/page";
import { useBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { POLL_POLICIES } from "@/lib/polling";

function Count({ value, label }: { value: number; label: string }) {
  if (value <= 0) {
    return null;
  }
  return (
    <span className="type-micro text-muted-foreground tabular-nums">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{value}</span>
    </span>
  );
}

export function AutomationTabs() {
  const { t } = useTranslation();
  const board = useBoard({ policy: POLL_POLICIES.shell });
  const counts = board.data?.board.counts;
  const trigger = cn(
    tabsTriggerVariants({ variant: "line" }),
    "flex-none px-2.5"
  );
  return (
    <nav aria-label={t("automation.tabsLabel")}>
      <div className={cn(tabsListVariants({ variant: "line" }), "border-b-0")}>
        <Link
          activeOptions={{ exact: true, includeSearch: false }}
          className={trigger}
          to="/automation"
        >
          {t("automation.tabs.approvals")}
          <Count
            label={t("nav.countLabel", {
              count: counts?.approvals_pending ?? 0,
            })}
            value={counts?.approvals_pending ?? 0}
          />
        </Link>
        <Link className={trigger} to="/automation/rules">
          {t("automation.tabs.rules")}
        </Link>
        <Link
          activeOptions={{ includeSearch: false }}
          className={trigger}
          to="/automation/runs"
        >
          {t("automation.tabs.runs")}
          <Count
            label={t("nav.countLabel", { count: counts?.tasks_live ?? 0 })}
            value={counts?.tasks_live ?? 0}
          />
        </Link>
      </div>
    </nav>
  );
}

export function AutomationLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        description={t("automation.intro")}
        title={t("automation.title")}
        wide
      >
        <div className="no-scrollbar -mb-px overflow-x-auto">
          <AutomationTabs />
        </div>
      </PageHeader>
      <Outlet />
    </div>
  );
}
