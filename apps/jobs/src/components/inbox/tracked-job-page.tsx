// A found job (12 §5, `/jobs/$ujbId`): the posting, its score with the
// explanation and components (07 §12), and where it came from. Track (S) is
// the page's one primary action; once tracked, the job lives on as its
// application, so a tracked job redirects there.

import type { UserJobDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { Salary } from "@pilihpendidikan/jobs-contracts/records";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Band, Rail } from "@rulisme/ui/ui/rails";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, ExternalLink, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PlainText } from "@/components/rich-text";
import { useInboxBulk } from "@/hooks/use-inbox";
import type { Locale, Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { formatMoney, relativeTime } from "@/lib/format";
import { bulkFailedOutright, bulkToastText } from "@/lib/inbox-bulk";
import { scoreCell } from "@/lib/inbox-score";
import { trackedJobRedirect } from "@/lib/inbox-state";
import { postingStatusLabel, sourceLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import { safeHref } from "@/lib/safe-url";
import { DuplicateListings, ProvenanceFacts } from "./inbox-row-details";
import { ScoreBreakdown } from "./score-breakdown";

export type NavigateTo = (
  href: string,
  options?: { replace?: boolean }
) => void;

export function salaryText(
  salary: Salary | null,
  locale: Locale,
  t: Translate
): string | null {
  if (!salary) {
    return null;
  }
  if (salary.min !== undefined || salary.max !== undefined) {
    const range = [salary.min, salary.max]
      .filter((value): value is number => value !== undefined)
      .map((value) => formatMoney(value, salary.currency, locale))
      .join(" – ");
    return salary.period
      ? `${range} ${t(`salaryPeriods.${salary.period}`)}`
      : range;
  }
  return salary.raw ?? null;
}

function JobSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 px-4 py-6 sm:px-8">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-7 w-96 max-w-full" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function TrackedJobView({
  detail,
  busy,
  nowMs,
  onTrack,
  onDismiss,
  onNavigate,
}: {
  detail: UserJobDetail;
  busy: "track" | "dismiss" | null;
  nowMs: number;
  onTrack: () => void;
  onDismiss: () => void;
  onNavigate: (href: string, event?: MouseEvent) => void;
}) {
  const { locale, t } = useTranslation();
  const { posting, user_job: userJob, score } = detail;
  const cell = scoreCell(score);
  const location = posting.locations.map((entry) => entry.raw).join(" · ");
  const salary = salaryText(posting.salary, locale, t);
  const postingHref = safeHref(posting.canonical_url ?? posting.apply_url);
  const dismissed = userJob.inbox_state === "dismissed";
  const meta = [
    location || null,
    sourceLabel(t, posting.source_kind),
    posting.posted_at
      ? t("detail.posted", {
          when: relativeTime(posting.posted_at, nowMs, locale),
        })
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="flex flex-col">
      <Band>
        <Rail className="flex flex-col gap-3 px-4 py-6 sm:px-8" nodes={false}>
          <a
            className="type-caption inline-flex w-fit items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/inbox"
            onClick={(event) => onNavigate("/inbox", event)}
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {t("trackedJob.back")}
          </a>
          <div className="flex flex-col gap-1">
            <p className="type-caption text-muted-foreground">
              {posting.company_name}
            </p>
            <h1 className="type-title text-balance">{posting.title}</h1>
            <p className="type-caption flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
              <span>{meta.join(" · ")}</span>
              {cell.kind === "score" ? (
                <Badge className="tabular-nums" variant="outline">
                  {t("detail.score", { score: cell.value })}
                </Badge>
              ) : null}
              <Badge
                variant={posting.status === "open" ? "secondary" : "outline"}
              >
                {postingStatusLabel(t, posting.status)}
              </Badge>
              {dismissed ? (
                <Badge variant="outline">{t("inboxStates.dismissed")}</Badge>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-keyshortcuts="S"
              disabled={busy !== null}
              onClick={onTrack}
            >
              <Check aria-hidden="true" data-icon="inline-start" />
              {busy === "track"
                ? t("trackedJob.tracking")
                : t("trackedJob.track")}
              <Kbd aria-hidden="true">S</Kbd>
            </Button>
            {dismissed ? null : (
              <Button
                disabled={busy !== null}
                onClick={onDismiss}
                variant="outline"
              >
                <X aria-hidden="true" data-icon="inline-start" />
                {t("trackedJob.dismiss")}
              </Button>
            )}
            {postingHref ? (
              <Button asChild variant="ghost">
                <a href={postingHref} rel="noopener noreferrer" target="_blank">
                  <ExternalLink aria-hidden="true" data-icon="inline-start" />
                  {t("detail.openPosting")}
                </a>
              </Button>
            ) : null}
          </div>
          {dismissed ? (
            <p className="type-caption text-muted-foreground">
              {t("trackedJob.dismissedHelp")}
            </p>
          ) : null}
        </Rail>
      </Band>
      <Rail
        className="grid gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_20rem]"
        nodes={false}
      >
        <div className="flex min-w-0 flex-col gap-8">
          <section
            aria-labelledby="job-description-heading"
            className="flex flex-col gap-2"
          >
            <h2
              className="type-subtitle weight-semibold"
              id="job-description-heading"
            >
              {t("detail.description")}
            </h2>
            {posting.description_text ? (
              <PlainText
                className="type-body max-w-[72ch]"
                text={posting.description_text}
              />
            ) : (
              <p className="type-body text-muted-foreground">
                {t("detail.noDescription")}
              </p>
            )}
            {posting.description_truncated ? (
              <p className="type-caption text-muted-foreground">
                {t("detail.truncated")}
              </p>
            ) : null}
          </section>
          {posting.requirements.length > 0 ? (
            <section
              aria-labelledby="job-requirements-heading"
              className="flex flex-col gap-2"
            >
              <h2
                className="type-subtitle weight-semibold"
                id="job-requirements-heading"
              >
                {t("detail.requirements")}
              </h2>
              <ul className="type-body flex max-w-[72ch] list-disc flex-col gap-1 pl-5">
                {posting.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {salary ? (
            <section
              aria-labelledby="job-salary-heading"
              className="flex flex-col gap-1"
            >
              <h2
                className="type-subtitle weight-semibold"
                id="job-salary-heading"
              >
                {t("detail.salary")}
              </h2>
              <p className="type-body tabular-nums">{salary}</p>
            </section>
          ) : null}
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <section
            aria-labelledby="job-score-heading"
            className="type-caption flex flex-col gap-2"
          >
            <h2
              className="type-subtitle weight-semibold text-foreground"
              id="job-score-heading"
            >
              {t("inbox.score.heading")}
            </h2>
            {cell.kind === "none" ? (
              <p className="text-muted-foreground">{t("trackedJob.noScore")}</p>
            ) : null}
            {cell.kind === "queued" ? (
              <p className="text-muted-foreground">{t("card.scoring")}</p>
            ) : null}
            {score && cell.kind === "score" ? (
              <ScoreBreakdown load postingId={posting.id} score={score} />
            ) : null}
          </section>
          <section
            aria-labelledby="job-provenance-heading"
            className="flex flex-col gap-2"
          >
            <h2
              className="type-subtitle weight-semibold"
              id="job-provenance-heading"
            >
              {t("inbox.details.provenance")}
            </h2>
            <ProvenanceFacts
              posting={posting}
              runId={userJob.first_run_id}
              sourceName={null}
            />
          </section>
          <section
            aria-labelledby="job-duplicates-heading"
            className="flex flex-col gap-2"
          >
            <h2
              className="type-subtitle weight-semibold"
              id="job-duplicates-heading"
            >
              {t("inbox.details.duplicates")}
            </h2>
            <DuplicateListings duplicates={0} posting={posting} />
          </section>
        </aside>
      </Rail>
    </div>
  );
}

const MINUTE_MS = 60_000;

export function TrackedJobPage({
  ujbId,
  onNavigate,
  notFound,
}: {
  ujbId: string;
  onNavigate: NavigateTo;
  /** What a missing or not-owned job shows (the app's not-found screen). */
  notFound: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bulk = useInboxBulk();
  const [busy, setBusy] = useState<"track" | "dismiss" | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const query = useQuery({
    queryKey: queryKeys.userJob(ujbId),
    queryFn: () =>
      api("GET /api/v1/user-jobs/{ujb_id}", { params: { ujb_id: ujbId } }),
  });
  const detail = query.data;
  const redirect = detail ? trackedJobRedirect(detail) : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (redirect && busy === null) {
      onNavigate(redirect, { replace: true });
    }
  }, [busy, onNavigate, redirect]);

  async function act(action: "track" | "dismiss") {
    if (!detail || busy !== null || redirect) {
      return;
    }
    setBusy(action);
    try {
      const { summary } = await bulk(
        action,
        [detail.user_job.id],
        new Map([[detail.user_job.id, detail.user_job.inbox_state]])
      );
      const text = bulkToastText(t, summary);
      if (bulkFailedOutright(summary)) {
        toast.error(text);
        return;
      }
      toast.success(text);
      const [applicationId] = summary.applicationIds;
      if (action === "track" && applicationId) {
        onNavigate(`/applications/${encodeURIComponent(applicationId)}`, {
          replace: true,
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.userJob(ujbId),
      });
    } catch {
      toast.error(t("inbox.bulk.error"));
    } finally {
      setBusy(null);
    }
  }

  useShortcut(
    "s",
    () => {
      act("track");
    },
    Boolean(detail) && !redirect
  );

  if (query.isError && isApiError(query.error) && query.error.status === 404) {
    return notFound;
  }
  if (!detail || redirect) {
    if (query.isPending || redirect) {
      return (
        <>
          <JobSkeleton />
          {redirect ? (
            <p className="sr-only" role="status">
              {t("trackedJob.redirecting")}
            </p>
          ) : null}
        </>
      );
    }
    return (
      <div className="p-4 sm:p-5">
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("trackedJob.errorTitle")}</AlertTitle>
          <AlertDescription>{t("inbox.error")}</AlertDescription>
          <AlertAction>
            <Button onClick={() => query.refetch()} size="sm" variant="outline">
              {t("common.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }
  return (
    <TrackedJobView
      busy={busy}
      detail={detail}
      nowMs={nowMs}
      onDismiss={() => {
        act("dismiss");
      }}
      onNavigate={(href, event) => {
        if (
          event &&
          (event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey)
        ) {
          return;
        }
        event?.preventDefault();
        onNavigate(href);
      }}
      onTrack={() => {
        act("track");
      }}
    />
  );
}
