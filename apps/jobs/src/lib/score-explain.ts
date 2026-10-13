// The score explanation (07 §5) re-rendered from `match_scores.components` in
// the viewer's language: the same deterministic templates as the api's
// `explainScore` (apps/api/src/jobs/services/scoring/explain.ts), mirrored
// under `score.explanation.*` in the locales (the parity test compares both).
// The stored `explanation` is localized to the user's settings; this lets a
// screen show the component lines in the UI language without another call.

import type { ScoreComponents } from "@pilihpendidikan/jobs-contracts/scoring";
import { ScoreComponentsSchema } from "@pilihpendidikan/jobs-contracts/scoring";
import type { Translate } from "@/i18n";

const MAX_LISTED_MATCHED = 6;
const MAX_LISTED_MISSING = 4;
const GATE_ORDER = { blocking: 0, possible: 1 } as const;
const AI_LEVELS = ["poor", "weak", "partial", "good", "excellent"] as const;
const KNOWN_LOCATIONS = new Set([
  "remote_in_country",
  "remote_anywhere",
  "location_match",
  "hybrid_same_country",
  "remote_outside_region",
  "outside_locations",
]);
const K = "score.explanation";

function band(score: number): string {
  if (score >= 80) {
    return "strong";
  }
  if (score >= 60) {
    return "good";
  }
  return score >= 40 ? "partial" : "weak";
}

function list(t: Translate, items: readonly string[], max: number): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max
    ? `${shown}, ${t(`${K}.more`, { count: items.length - max })}`
    : shown;
}

function skillsLine(
  t: Translate,
  skills: ScoreComponents["features"]["skills_overlap"]
): string {
  if (!skills) {
    return t(`${K}.skillsUnknown`);
  }
  const total = skills.matched.length + skills.missing.length;
  const missing =
    skills.missing.length > 0
      ? `   ${t(`${K}.skillsMissing`, { list: list(t, skills.missing, MAX_LISTED_MISSING) })}`
      : "";
  if (skills.matched.length === 0) {
    return `✗ ${t(`${K}.skillsNone`, { total })}${missing}`;
  }
  const mark = skills.value >= 0.5 ? "✓" : "~";
  return `${mark} ${t(`${K}.skills`, {
    list: list(t, skills.matched, MAX_LISTED_MATCHED),
    matched: skills.matched.length,
    total,
  })}${missing}`;
}

function titleLine(
  t: Translate,
  title: ScoreComponents["features"]["title_similarity"]
): string {
  if (!title) {
    return t(`${K}.title.none`);
  }
  const target = title.best_target ?? "";
  if (title.value >= 0.99) {
    return t(`${K}.title.exact`, { target });
  }
  if (title.value >= 0.5) {
    return t(`${K}.title.close`, { target });
  }
  return title.value > 0
    ? t(`${K}.title.partial`, { target })
    : t(`${K}.title.differs`);
}

function seniorityLine(
  t: Translate,
  seniority: NonNullable<ScoreComponents["features"]["seniority_fit"]>
): string {
  const word = (level: string) =>
    level === "unknown" ? "?" : t(`${K}.seniorityWords.${level}`);
  let mark = "✗";
  if (seniority.value >= 0.99) {
    mark = "✓";
  } else if (seniority.value >= 0.6) {
    mark = "~";
  }
  return `${mark} ${t(`${K}.seniority`, {
    posting: word(seniority.posting),
    user: word(seniority.user),
  })}`;
}

function salaryLine(t: Translate, value: number): string {
  if (value >= 0.99) {
    return t(`${K}.salary.meets`);
  }
  return value > 0 ? t(`${K}.salary.slightly`) : t(`${K}.salary.below`);
}

function aiLine(t: Translate, ai: ScoreComponents["ai"]): string {
  if (ai.status !== "ok") {
    return t(`${K}.aiStatus.${ai.status}`);
  }
  if (!ai.overall_fit) {
    return t(`${K}.aiDeclined`);
  }
  const level = Math.min(4, Math.max(0, Math.round(ai.overall_fit.score)));
  const label = t(`${K}.aiLevels.${AI_LEVELS[level] ?? "partial"}`);
  return ai.overall_fit.confidence === null
    ? t(`${K}.aiFit`, { label })
    : t(`${K}.aiFitConfidence`, {
        label,
        confidence: Math.round(ai.overall_fit.confidence * 100),
      });
}

/** The explanation lines of `components` (the first is "78 · Good match"). */
export function explainScoreLines(
  t: Translate,
  components: ScoreComponents
): string[] {
  const lines = [
    `${components.score} · ${t(`${K}.bands.${band(components.score)}`)}`,
  ];
  const gates = [...components.gates].sort(
    (a, b) => GATE_ORDER[a.level] - GATE_ORDER[b.level]
  );
  for (const gate of gates) {
    lines.push(
      `${t(`${K}.gateLevel.${gate.level}`)}: ${t(`${K}.gate.${gate.predicate}`)}`
    );
  }
  const f = components.features;
  lines.push(skillsLine(t, f.skills_overlap));
  lines.push(titleLine(t, f.title_similarity));
  if (f.location_fit) {
    lines.push(
      KNOWN_LOCATIONS.has(f.location_fit.reason)
        ? t(`${K}.location.${f.location_fit.reason}`)
        : `· ${f.location_fit.reason}`
    );
  }
  if (f.seniority_fit) {
    lines.push(seniorityLine(t, f.seniority_fit));
  }
  if (f.salary_fit) {
    lines.push(salaryLine(t, f.salary_fit.value));
  }
  if (f.language_fit) {
    const codes = (items: readonly string[]) =>
      items.map((code) => code.toUpperCase()).join(", ");
    lines.push(
      f.language_fit.missing.length === 0
        ? t(`${K}.languagesMet`, { codes: codes(f.language_fit.required) })
        : t(`${K}.languagesMissing`, { codes: codes(f.language_fit.missing) })
    );
  }
  if (f.freshness && f.freshness.value < 1) {
    lines.push(t(`${K}.freshness`, { days: f.freshness.age_days }));
  }
  lines.push(aiLine(t, components.ai));
  return lines;
}

/** Components of a stored score, or null while it is queued (`{}`). */
export function scoreComponentsOf(raw: unknown): ScoreComponents | null {
  const parsed = ScoreComponentsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
