// One (user, posting) score (07 §3–§5): deterministic features, the AI
// rubric when it is allowed and affordable, the gates, the stored components
// and the explanation.
//
// AI is skipped (deterministic-only, `components.ai.status`):
//   disabled  the AI_DISABLED kill switch (D-33) or no AI consent (11 §11)
//   skipped   the profile is too thin: no skills, no target titles (07 §11)
//   budget    the call would cross the user's month / day cap (D-34)
//   error     the provider rejected the request or its output (400, schema)
//   dlq       the message exhausted its retries (jobs-ai-dlq)
// A retryable provider error (429, 5xx, timeout) is thrown so the queue
// message is retried with backoff.

import type { ScoreComponents } from "@pilihpendidikan/jobs-contracts/scoring";
import { scoreRequest } from "../../ai/compose";
import type { AiProvider, ScorePostingView } from "../../ai/provider";
import type { AiUsage } from "../../ai/primitives";
import { estimateDecisionCost, isAiProviderError } from "../../ai/primitives";
import type { AiOutcome } from "./combine";
import {
  assembleComponents,
  noAi,
  scoreConfidence,
  scoreModel,
} from "./combine";
import type { UserScoringContext } from "./context";
import { explainScore } from "./explain";
import type { PostingForScoring } from "./features";
import { computeFeatures } from "./features";

export interface ComputedScore {
  components: ScoreComponents;
  confidence: number | null;
  explanation: string;
  model: string;
  score: number;
  /** Provider usage of this score (null without an AI call). */
  usage: AiUsage | null;
}

/** The posting fields the AI rubric sees (07 §2.2, §8): no URLs, no HTML. */
export function postingView(posting: PostingForScoring): ScorePostingView {
  return {
    title: posting.title,
    department: posting.department,
    seniority: posting.seniority,
    locations: posting.locations.map((location) => location.raw),
    workplace_type: posting.workplace_type,
    employment_type: posting.employment_type,
    requirements: posting.requirements,
    description_text: posting.description_text,
  };
}

export type AiMode = "normal" | "dlq";

async function aiOutcome(
  ctx: UserScoringContext,
  posting: PostingForScoring,
  ai: () => AiProvider,
  mode: AiMode
): Promise<{ outcome: AiOutcome; usage: AiUsage | null }> {
  if (mode === "dlq") {
    return { outcome: noAi("dlq"), usage: null };
  }
  if (ctx.aiDisabled || !ctx.aiConsent) {
    return { outcome: noAi("disabled"), usage: null };
  }
  if (ctx.thin) {
    return { outcome: noAi("skipped"), usage: null };
  }
  const input = {
    askSensitive: ctx.sensitiveAllowed,
    posting: postingView(posting),
    profile: ctx.aiProfile,
  };
  const estimate = estimateDecisionCost(scoreRequest(input));
  if (!ctx.budget.tryReserve(estimate)) {
    return { outcome: noAi("budget"), usage: null };
  }
  try {
    const result = await ai().scorePosting(input);
    ctx.budget.settle(estimate, result.usage.cost_micro_usd);
    return {
      outcome: {
        status: "ok",
        overall_fit: result.overall_fit,
        predicates: result.predicates,
        refused: result.refused,
      },
      usage: result.usage,
    };
  } catch (err) {
    ctx.budget.release(estimate);
    if (isAiProviderError(err) && !err.retryable) {
      return { outcome: noAi("error"), usage: null };
    }
    throw err;
  }
}

/** Scores one posting for the context's user. */
export async function computeScore(
  ctx: UserScoringContext,
  posting: PostingForScoring,
  options: { ai: () => AiProvider; mode: AiMode; now: number }
): Promise<ComputedScore> {
  const features = computeFeatures(ctx.profile, posting, options.now);
  const { outcome, usage } = await aiOutcome(
    ctx,
    posting,
    options.ai,
    options.mode
  );
  const components = assembleComponents(features, outcome, posting.revision);
  return {
    components,
    score: components.score,
    confidence: scoreConfidence(components),
    model: scoreModel(components),
    explanation: explainScore(components, ctx.locale),
    usage,
  };
}
