// Inbox empty states (12 §4): no sources yet, sources but no run yet (with
// the copyable `pilih-jobs discover --all`), all caught up, nothing matching
// the filters, or an empty Seen / Dismissed tab.

import { Button } from "@rulisme/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Rss } from "lucide-react";
import type { MouseEvent } from "react";
import { CopyCommand } from "@/components/copy-command";
import { useTranslation } from "@/i18n";
import { relativeTime } from "@/lib/format";
import type { InboxEmptyKind } from "@/lib/inbox-state";

/** The discovery command shown when no run happened yet (22 §12). */
export const DISCOVER_ALL_COMMAND = "pilih-jobs discover --all";

export function InboxEmpty({
  kind,
  tab,
  lastRunAt,
  nowMs,
  onClearFilters,
  onNavigate,
}: {
  kind: InboxEmptyKind;
  tab: "new" | "seen" | "dismissed";
  lastRunAt: number | null;
  nowMs: number;
  onClearFilters: () => void;
  onNavigate: (href: string, event?: MouseEvent) => void;
}) {
  const { locale, t } = useTranslation();
  let title = t("inbox.empty.caughtUpTitle");
  let description = lastRunAt
    ? t("inbox.empty.caughtUp", {
        when: relativeTime(lastRunAt, nowMs, locale),
      })
    : t("inbox.empty.caughtUpNoRun");
  if (kind === "no_sources") {
    title = t("inbox.empty.noSourcesTitle");
    description = t("inbox.empty.noSources");
  } else if (kind === "no_runs") {
    title = t("inbox.empty.noRunsTitle");
    description = t("inbox.empty.noRuns");
  } else if (kind === "no_matches") {
    title = t("inbox.empty.noMatchesTitle");
    description = t("inbox.empty.noMatches");
  } else if (kind === "empty_tab") {
    title = t("inbox.empty.emptyTabTitle");
    description =
      tab === "dismissed"
        ? t("inbox.empty.emptyDismissed")
        : t("inbox.empty.emptySeen");
  }
  return (
    <Empty
      className="graph-paper m-4 border border-dashed py-10 sm:m-5"
      data-empty={kind}
    >
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {kind === "no_sources" ? (
        <EmptyContent>
          <Button asChild size="sm" variant="outline">
            <a
              href="/sources"
              onClick={(event) => onNavigate("/sources", event)}
            >
              <Rss aria-hidden="true" data-icon="inline-start" />
              {t("inbox.empty.addSource")}
            </a>
          </Button>
        </EmptyContent>
      ) : null}
      {kind === "no_runs" ? (
        <EmptyContent>
          <CopyCommand
            className="w-full max-w-xs"
            command={DISCOVER_ALL_COMMAND}
          />
          <p className="type-caption text-muted-foreground">
            {t("inbox.empty.noRunsHelp")}{" "}
            <a
              className="text-primary underline-offset-4 hover:underline"
              href="/cli"
              onClick={(event) => onNavigate("/cli", event)}
            >
              {t("inbox.empty.connectCli")}
            </a>
          </p>
        </EmptyContent>
      ) : null}
      {kind === "no_matches" ? (
        <EmptyContent>
          <Button onClick={onClearFilters} size="sm" variant="outline">
            {t("inbox.empty.clearFilters")}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
