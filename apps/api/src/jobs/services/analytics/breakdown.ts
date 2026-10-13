// `GET /api/v1/analytics/breakdown` (10 §2.6): the period's cohort
// (applications that first reached applied in the period) grouped by one
// dimension. `n` is the group's cohort size and the denominator of its rates;
// rates are null below 5 (10 §2.2).
//
//   source          the configured source (job_sources.label), else the
//                   posting's source kind
//   company         job_postings.company_name, top 20 by n, the rest "Other"
//   mode            applications.mode when applied was recorded (stage event
//                   payload), the current mode for older / legacy rows
//   method          applications.submission_method ("unknown" when unset)
//   cv_variant      base CV vs tailored CV (per template)
//   score_band      the ready match score in force when applied was recorded
//                   (the latest one created at or before it), not the latest
//   workplace_type  the posting's workplace type

import type { AnalyticsBreakdownResponse } from "@pilihpendidikan/jobs-contracts/api";
import type { AnalyticsBreakdown } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  PostingFactRow,
  ScoreFactRow,
  SourceFactRow,
  VariantFactRow,
} from "../../repo/analytics";
import type { AppTimeline } from "./model";
import { responded } from "./model";
import { ratio, showsRates } from "./stats";

export const TOP_COMPANIES = 20;
export const OTHER_KEY = "other";

export type BreakdownRow = AnalyticsBreakdownResponse["rows"][number] & {
  response_rate: number | null;
};

export interface BreakdownContext {
  postings: ReadonlyMap<string, PostingFactRow>;
  /** Ready scores per posting, oldest first. */
  scores: ReadonlyMap<string, readonly ScoreFactRow[]>;
  sources: ReadonlyMap<string, SourceFactRow>;
  variants: ReadonlyMap<string, VariantFactRow>;
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  workday: "Workday",
  career_page: "Career page",
  generic_listing: "Job listing",
  custom_url: "Custom URL",
  manual: "Added manually",
  email: "Email",
  legacy: "Imported (legacy)",
};

const MODE_LABELS: Readonly<Record<string, string>> = {
  manual: "Manual",
  assisted: "Assisted",
  approval: "Approval",
  auto: "Auto",
};

const METHOD_LABELS: Readonly<Record<string, string>> = {
  browser: "Browser",
  email: "Email",
  ats_api: "ATS API",
  manual: "Manual",
  unknown: "Unknown",
};

const TEMPLATE_LABELS: Readonly<Record<string, string>> = {
  basic: "Basic",
  harvard: "Harvard",
  simple: "Simple",
  standard: "Standard",
};

const WORKPLACE_LABELS: Readonly<Record<string, string>> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
  unknown: "Unknown",
};

export const SCORE_BANDS = [
  { key: "80_plus", label: "80 and above", min: 80 },
  { key: "60_79", label: "60–79", min: 60 },
  { key: "below_60", label: "Below 60", min: 0 },
] as const;
const UNSCORED = { key: "unscored", label: "Unscored" } as const;
const SPACES_RE = /\s+/g;

interface Group {
  key: string;
  label: string;
}

/** The score row in force at `at`: the latest ready score created by then. */
export function scoreAt(
  scores: readonly ScoreFactRow[] | undefined,
  at: number
): number | null {
  let found: ScoreFactRow | null = null;
  for (const score of scores ?? []) {
    if (
      score.created_at <= at &&
      (!found || score.created_at >= found.created_at)
    ) {
      found = score;
    }
  }
  return found ? found.score : null;
}

/** The score band of a score (10 §2.6). */
export function scoreBand(score: number | null): Group {
  if (score === null) {
    return UNSCORED;
  }
  const band =
    SCORE_BANDS.find((entry) => score >= entry.min) ?? SCORE_BANDS[2];
  return { key: band.key, label: band.label };
}

function companyKey(name: string): string {
  return name.trim().toLowerCase().replace(SPACES_RE, " ");
}

function groupOf(
  by: AnalyticsBreakdown,
  timeline: AppTimeline,
  context: BreakdownContext
): Group {
  const { app } = timeline;
  const posting = context.postings.get(app.posting_id);
  switch (by) {
    case "source": {
      const source = app.source_id
        ? context.sources.get(app.source_id)
        : undefined;
      if (source) {
        return { key: source.id, label: source.label };
      }
      const kind = posting?.source_kind ?? "unknown";
      return { key: kind, label: SOURCE_LABELS[kind] ?? kind };
    }
    case "company": {
      const name = posting?.company_name?.trim() || "Unknown company";
      return { key: companyKey(name), label: name };
    }
    case "mode":
      return {
        key: timeline.modeAtApplied,
        label: MODE_LABELS[timeline.modeAtApplied] ?? timeline.modeAtApplied,
      };
    case "method": {
      const method = app.submission_method ?? "unknown";
      return { key: method, label: METHOD_LABELS[method] ?? method };
    }
    case "cv_variant": {
      if (!app.cv_variant_id) {
        return { key: "base", label: "Base CV" };
      }
      const template = context.variants.get(app.cv_variant_id)?.template;
      return template
        ? {
            key: `tailored:${template}`,
            label: `Tailored CV (${TEMPLATE_LABELS[template] ?? template})`,
          }
        : { key: "tailored", label: "Tailored CV" };
    }
    case "score_band":
      return scoreBand(
        scoreAt(
          context.scores.get(app.posting_id),
          timeline.firsts.applied as number
        )
      );
    case "workplace_type": {
      const type = posting?.workplace_type ?? "unknown";
      return { key: type, label: WORKPLACE_LABELS[type] ?? type };
    }
    default:
      return { key: "unknown", label: "Unknown" };
  }
}

function rowOf(group: Group, members: readonly AppTimeline[]): BreakdownRow {
  const n = members.length;
  const rated = showsRates(n);
  const rate = (test: (t: AppTimeline) => boolean) =>
    rated ? ratio(members.filter(test).length, n) : null;
  return {
    key: group.key,
    label: group.label,
    applied: n,
    n,
    response_rate: rate(responded),
    interview_rate: rate((t) => t.firsts.interviewing !== undefined),
    offer_rate: rate((t) => t.firsts.offer !== undefined),
    rejection_rate: rate((t) => t.firsts.rejected !== undefined),
  };
}

function byCount(a: BreakdownRow, b: BreakdownRow): number {
  return (
    b.n - a.n || a.label.localeCompare(b.label) || (a.key < b.key ? -1 : 1)
  );
}

/** The breakdown rows of `cohort` by `by`. */
export function computeBreakdown(
  by: AnalyticsBreakdown,
  cohort: readonly AppTimeline[],
  context: BreakdownContext
): BreakdownRow[] {
  const groups = new Map<string, { group: Group; members: AppTimeline[] }>();
  for (const timeline of cohort) {
    const group = groupOf(by, timeline, context);
    const entry = groups.get(group.key);
    if (entry) {
      entry.members.push(timeline);
    } else {
      groups.set(group.key, { group, members: [timeline] });
    }
  }
  const rows = [...groups.values()]
    .map((entry) => rowOf(entry.group, entry.members))
    .sort(byCount);
  if (by !== "company" || rows.length <= TOP_COMPANIES) {
    return rows;
  }
  const top = rows.slice(0, TOP_COMPANIES);
  const restKeys = new Set(rows.slice(TOP_COMPANIES).map((row) => row.key));
  const rest = [...groups.values()]
    .filter((entry) => restKeys.has(entry.group.key))
    .flatMap((entry) => entry.members);
  return [...top, rowOf({ key: OTHER_KEY, label: "Other" }, rest)];
}
