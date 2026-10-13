// Scores in the inbox (12 §4, 07 §5 / §12): the score cell (a number with a
// bar, ◌ while queued, — when there is none), score bands for the filter,
// the deterministic explanation split into marked lines, and the component
// breakdown of `match_scores.components`. No score is shown without its
// explanation one click away (07 §12).

import type { ScoreSummary } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ComponentName,
  ScoreComponents,
} from "@pilihpendidikan/jobs-contracts/scoring";

/** Score bands of the inbox filter (07 §12): ≥ 80, 60–79, < 60, unscored. */
export const SCORE_BANDS = ["high", "mid", "low", "unscored"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const HIGH_SCORE = 80;
export const MID_SCORE = 60;

export type ScoreCell =
  | {
      kind: "score";
      value: number;
      band: Exclude<ScoreBand, "unscored">;
      aiOff: boolean;
    }
  | { kind: "queued" }
  | { kind: "none" };

/** What the score cell shows for a row's score summary. */
export function scoreCell(score: ScoreSummary | null): ScoreCell {
  if (!score || score.status === "failed") {
    return { kind: "none" };
  }
  if (score.status === "queued") {
    return { kind: "queued" };
  }
  let band: Exclude<ScoreBand, "unscored"> = "low";
  if (score.score >= HIGH_SCORE) {
    band = "high";
  } else if (score.score >= MID_SCORE) {
    band = "mid";
  }
  return {
    kind: "score",
    value: score.score,
    band,
    aiOff: score.deterministic_only,
  };
}

export function scoreBandOf(score: ScoreSummary | null): ScoreBand {
  const cell = scoreCell(score);
  return cell.kind === "score" ? cell.band : "unscored";
}

/** Sort key: ready scores first (highest first), then queued, then none. */
export function scoreSortValue(score: ScoreSummary | null): number {
  const cell = scoreCell(score);
  if (cell.kind === "score") {
    return cell.value;
  }
  return cell.kind === "queued" ? -1 : -2;
}

export type ExplanationMark =
  | "match"
  | "missing"
  | "partial"
  | "warning"
  | "neutral";

export interface ExplanationLine {
  mark: ExplanationMark | null;
  text: string;
}

const MARKS: Readonly<Record<string, ExplanationMark>> = {
  "✓": "match",
  "✗": "missing",
  "~": "partial",
  "⚠": "warning",
  "·": "neutral",
};
const SEGMENT_SPLIT_RE = /\s{2,}(?=[✓✗~⚠])/u;

/**
 * The explanation (07 §5 templates) as marked lines: one entry per line, a
 * line with several marked parts ("✓ Skills …  ✗ Missing …") split into
 * one entry each. The headline ("78 · Good match") has no mark.
 */
export function explanationLines(explanation: string): ExplanationLine[] {
  const lines: ExplanationLine[] = [];
  for (const raw of explanation.split("\n")) {
    for (const part of raw.trim().split(SEGMENT_SPLIT_RE)) {
      const segment = part.trim();
      if (!segment) {
        continue;
      }
      const mark = MARKS[segment.charAt(0)] ?? null;
      lines.push({
        mark,
        text: mark ? segment.slice(1).trim() : segment,
      });
    }
  }
  return lines;
}

/** A gate line ("⚠ Possible blocker: …") marks a posting with a blocker. */
export function hasBlocker(score: ScoreSummary | null): boolean {
  if (!score || score.status !== "ready") {
    return false;
  }
  return explanationLines(score.explanation).some(
    (line) => line.mark === "warning"
  );
}

export interface ComponentRow {
  name: ComponentName;
  /** 0–1 contribution before weighting. */
  value: number;
  weight: number;
}

const AI_FIT_MAX = 4;
const FEATURE_ORDER = [
  "skills_overlap",
  "title_similarity",
  "location_fit",
  "seniority_fit",
  "salary_fit",
  "language_fit",
  "freshness",
] as const;

/**
 * One bar per present component, in the 07 §3 order; the AI fit (0–4) is
 * scaled to 0–1 and shown only when the AI component ran. The words for
 * each component come from the explanation lines (`explainScoreLines`).
 */
export function componentRows(components: ScoreComponents): ComponentRow[] {
  const rows: ComponentRow[] = [];
  for (const name of FEATURE_ORDER) {
    const feature = components.features[name];
    if (feature) {
      rows.push({ name, value: feature.value, weight: feature.weight });
    }
  }
  const { ai } = components;
  if (ai.status === "ok" && ai.overall_fit) {
    rows.push({
      name: "ai",
      value: Math.min(1, ai.overall_fit.score / AI_FIT_MAX),
      weight: ai.weight,
    });
  }
  return rows;
}

/** Bar width in percent for a 0–1 value (a sliver stays visible). */
export function barPercent(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.max(4, Math.round(clamped * 100));
}
