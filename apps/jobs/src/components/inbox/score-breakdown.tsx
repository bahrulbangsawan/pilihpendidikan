// A score's explanation and component breakdown (07 §5, §12). The rows carry
// only the score summary; opening a breakdown loads the full score
// (`GET /api/v1/scores/{posting_id}`). With its components, the explanation
// is re-rendered in the viewer's language (`explainScoreLines`, the same
// deterministic templates as the api — never generative) next to one bar
// per component; until then, the stored explanation (already in the user's
// settings language) stands in.

import type { ScoreSummary } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import { useScoreDetail } from "@/hooks/use-inbox";
import { useTranslation } from "@/i18n";
import { formatPercent } from "@/lib/format";
import type { ComponentRow, ExplanationLine } from "@/lib/inbox-score";
import { barPercent, componentRows, explanationLines } from "@/lib/inbox-score";
import { explainScoreLines, scoreComponentsOf } from "@/lib/score-explain";

const MARK_GLYPH: Record<NonNullable<ExplanationLine["mark"]>, string> = {
  match: "✓",
  missing: "✗",
  partial: "~",
  warning: "⚠",
  neutral: "·",
};

/** Stable keys for static lines (text + occurrence), headline flagged. */
function keyedLines(lines: readonly ExplanationLine[]) {
  const seen = new Map<string, number>();
  return lines.map((line, position) => {
    const base = `${line.mark ?? "-"}:${line.text}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      ...line,
      key: `${base}#${occurrence}`,
      headline: position === 0 && line.mark === null,
    };
  });
}

/** Explanation text (lines with ✓ ✗ ~ ⚠ · marks) as a marked list. */
export function ExplanationList({
  explanation,
  className,
}: {
  explanation: string;
  className?: string;
}) {
  const lines = keyedLines(explanationLines(explanation));
  if (lines.length === 0) {
    return null;
  }
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {lines.map((line) => (
        <li
          className={cn("flex gap-1.5", line.headline && "weight-semibold")}
          key={line.key}
        >
          {line.mark ? (
            <span aria-hidden="true" className="w-3 shrink-0">
              {MARK_GLYPH[line.mark]}
            </span>
          ) : null}
          <span className="min-w-0">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One bar per component, with its value and weight. */
export function ComponentBars({
  rows,
  tone = "default",
}: {
  rows: readonly ComponentRow[];
  /** `inverse` on the dark tooltip fill. */
  tone?: "default" | "inverse";
}) {
  const { locale, t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li className="flex flex-col gap-0.5" key={row.name}>
          <div className="flex items-baseline justify-between gap-3">
            <span>{t(`inbox.score.components.${row.name}`)}</span>
            <span className="tabular-nums">
              {formatPercent(row.value, locale)}
              <span
                className={cn(
                  "ml-1.5",
                  tone === "inverse"
                    ? "text-tooltip-foreground/70"
                    : "text-muted-foreground"
                )}
              >
                {t("inbox.score.weight", {
                  weight: formatPercent(row.weight, locale),
                })}
              </span>
            </span>
          </div>
          <span
            aria-hidden="true"
            className={cn(
              "relative h-1 w-full",
              tone === "inverse" ? "bg-tooltip-foreground/20" : "bg-pane"
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0",
                tone === "inverse" ? "bg-tooltip-foreground" : "bg-primary"
              )}
              style={{ width: `${barPercent(row.value)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The explanation and, once loaded, the components. `load` gates the fetch
 * (a tooltip loads only once it opens).
 */
export function ScoreBreakdown({
  postingId,
  score,
  load,
  tone = "default",
}: {
  postingId: string;
  score: ScoreSummary;
  load: boolean;
  tone?: "default" | "inverse";
}) {
  const { t } = useTranslation();
  const detail = useScoreDetail(postingId, load && score.status === "ready");
  const record = detail.data?.score;
  const components =
    record?.status === "ready" ? scoreComponentsOf(record.components) : null;
  const explanation = components
    ? explainScoreLines(t, components).join("\n")
    : score.explanation;
  const muted =
    tone === "inverse" ? "text-tooltip-foreground/80" : "text-muted-foreground";
  return (
    <div className="flex w-full flex-col gap-3">
      <ExplanationList explanation={explanation} />
      {score.deterministic_only ? (
        <p className={muted}>{t("card.aiOff")}</p>
      ) : null}
      {score.status === "ready" ? (
        <section
          aria-label={t("inbox.score.components.label")}
          className="flex flex-col gap-2"
        >
          {detail.isPending && load ? (
            <p className={muted}>{t("inbox.score.loading")}</p>
          ) : null}
          {detail.isError ? (
            <p className={muted}>{t("inbox.score.unavailable")}</p>
          ) : null}
          {components ? (
            <ComponentBars rows={componentRows(components)} tone={tone} />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
