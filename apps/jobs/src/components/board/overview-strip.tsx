// The board's overview strip (10 §8): applied this week, response rate (the
// 30-day cohort), interviews upcoming, follow-ups due. Rates hide below a
// cohort of 5 (10 §2.2).

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { DAY_MS, isoDay, startOfWeek } from "@/lib/board-model";
import { browserTimeZone, formatNumber, formatPercent } from "@/lib/format";
import { queryKeys } from "@/lib/query";

const SUMMARY_STALE_MS = 5 * 60_000;

function useSummary(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.overview(from, to),
    queryFn: () =>
      api("GET /api/v1/analytics/summary", {
        query: { from, to, tz: browserTimeZone() },
      }),
    staleTime: SUMMARY_STALE_MS,
    retry: false,
  });
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-line border-r border-b px-4 py-2 even:border-r-0 sm:border-b-0 sm:px-6 sm:even:border-r sm:last:border-r-0 [&:nth-child(n+3)]:border-b-0">
      <dt className="type-caption truncate text-muted-foreground">{label}</dt>
      <dd className="type-title-compact text-foreground tabular-nums">
        {value}
        {hint ? (
          <span className="type-micro ml-1.5 text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

export function OverviewStrip({
  followUpsDue,
  interviewsUpcoming,
  nowMs,
}: {
  followUpsDue: number | null;
  interviewsUpcoming: number | null;
  nowMs: number;
}) {
  const { locale, t } = useTranslation();
  const today = isoDay(new Date(nowMs));
  const week = useSummary(isoDay(startOfWeek(nowMs)), today);
  const month = useSummary(isoDay(new Date(nowMs - 30 * DAY_MS)), today);
  const dash = "—";
  const rate = month.data?.rates?.response_rate;
  return (
    <dl
      aria-label={t("board.overview.label")}
      className="band grid grid-cols-2 sm:grid-cols-4"
    >
      <Stat
        label={t("board.overview.appliedThisWeek")}
        value={week.data ? formatNumber(week.data.cohort_size, locale) : dash}
      />
      <Stat
        hint={
          month.data && rate == null
            ? t("board.overview.ratesLater")
            : undefined
        }
        label={t("board.overview.responseRate")}
        value={rate == null ? dash : formatPercent(rate, locale)}
      />
      <Stat
        label={t("board.overview.interviewsUpcoming")}
        value={
          interviewsUpcoming === null
            ? dash
            : formatNumber(interviewsUpcoming, locale)
        }
      />
      <Stat
        label={t("board.overview.followUpsDue")}
        value={
          followUpsDue === null ? dash : formatNumber(followUpsDue, locale)
        }
      />
    </dl>
  );
}
