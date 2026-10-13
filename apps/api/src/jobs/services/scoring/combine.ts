// Components → score (07 §3, §4.2, §4.3): renormalized weights over the known
// components, the AI rubric as one bounded component, gates as multipliers.
//
// [DECISION 07 §3] The AI rubric never carries more than 20 % of the base:
// its weight is min(0.20, 0.25 · Σ known feature weights), so with every
// feature known it is exactly 0.20, and when features are unknown it shrinks
// with them instead of growing through renormalization (T7-05).

import type {
  AiComponentStatus,
  GatePredicate,
  ScoreComponents,
  ScoreGate,
} from "@pilihpendidikan/jobs-contracts/scoring";
import {
  combineScore,
  DETERMINISTIC_ONLY_MODEL,
  FEATURE_NAMES,
  GATE_PREDICATES,
  gateFor,
  R1_WEIGHTS,
  RUBRIC_VERSION,
  ScoreComponentsSchema,
} from "@pilihpendidikan/jobs-contracts/scoring";
import { AI_MODELS } from "../../ai/primitives";
import { featureValues } from "./features";

/** Highest share of the base the AI component may carry (07 §3). */
export const AI_SHARE_MAX = R1_WEIGHTS.ai;
/** Score levels of the Decisions rubric: 0 (poor) … 4 (excellent). */
export const AI_SCORE_TOP = 4;

export interface AiOutcome {
  overall_fit: { confidence: number | null; score: number } | null;
  predicates: Partial<Record<GatePredicate, number | null>>;
  refused: string[];
  status: AiComponentStatus;
}

/** A deterministic-only AI outcome (budget, error, dlq, disabled, skipped). */
export function noAi(status: Exclude<AiComponentStatus, "ok">): AiOutcome {
  return { status, overall_fit: null, predicates: {}, refused: [] };
}

const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** The AI weight used next to these features (≤ 20 % of the base). */
export function aiWeightFor(features: ScoreComponents["features"]): number {
  const values = featureValues(features);
  let known = 0;
  for (const name of FEATURE_NAMES) {
    if (values[name] !== null) {
      known += R1_WEIGHTS[name];
    }
  }
  return Math.min(R1_WEIGHTS.ai, (known * AI_SHARE_MAX) / (1 - AI_SHARE_MAX));
}

/** Gates triggered by the AI predicates (07 §4.2). */
export function gatesFor(ai: AiOutcome): ScoreGate[] {
  if (ai.status !== "ok") {
    return [];
  }
  const gates: ScoreGate[] = [];
  for (const predicate of GATE_PREDICATES) {
    const gate = gateFor(predicate, ai.predicates[predicate] ?? null);
    if (gate) {
      gates.push(gate);
    }
  }
  return gates;
}

/** The stored `components` JSON (07 §4.3), validated. */
export function assembleComponents(
  features: ScoreComponents["features"],
  ai: AiOutcome,
  postingRevision: number
): ScoreComponents {
  const aiValue =
    ai.status === "ok" && ai.overall_fit
      ? Math.min(1, Math.max(0, ai.overall_fit.score / AI_SCORE_TOP))
      : null;
  const aiWeight = aiValue === null ? R1_WEIGHTS.ai : aiWeightFor(features);
  const gates = gatesFor(ai);
  const { base, score } = combineScore(
    { ...featureValues(features), ai: aiValue },
    gates,
    { ...R1_WEIGHTS, ai: aiWeight }
  );
  return ScoreComponentsSchema.parse({
    rubric_version: RUBRIC_VERSION,
    features,
    ai: {
      status: ai.status,
      overall_fit: ai.overall_fit
        ? {
            score: round(Math.min(AI_SCORE_TOP, ai.overall_fit.score), 3),
            confidence: ai.overall_fit.confidence,
          }
        : null,
      weight: round(aiWeight),
      predicates: ai.predicates,
      refused: ai.refused,
    },
    gates,
    base: round(base),
    score,
    posting_revision: Math.max(1, postingRevision),
  });
}

/** `match_scores.model`: the Decisions model when it contributed, else deterministic-only. */
export function scoreModel(components: ScoreComponents): string {
  return components.ai.status === "ok"
    ? AI_MODELS.decisions
    : DETERMINISTIC_ONLY_MODEL;
}

/** `match_scores.confidence`: the rubric's confidence, null without it (07 §11). */
export function scoreConfidence(components: ScoreComponents): number | null {
  return components.ai.status === "ok"
    ? (components.ai.overall_fit?.confidence ?? null)
    : null;
}
