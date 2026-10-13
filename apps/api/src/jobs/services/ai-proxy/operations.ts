// The four AI proxy operations (05 §9, 19 §4–§6, §9). Each runs inside
// `runAgentCall` (call.ts), which owns the lease check, the gates, the
// budget and the usage write; these build the provider input, pre-check its
// cost, call the provider and validate what comes back.

import type {
  FieldPlan,
  FieldPlanRequest,
  NextActionRequest,
  NextActionResponse,
  PageClassifyRequest,
  PageClassifyResponse,
  VerifySubmissionRequest,
  VerifySubmissionResponse,
} from "@pilihpendidikan/jobs-contracts/agent";
import {
  AGENT_THRESHOLDS,
  computeVerificationVerdict,
  PageClassifyResponseSchema,
  VerifySubmissionResponseSchema,
} from "@pilihpendidikan/jobs-contracts/agent";
import {
  chooseRequest,
  classifyRequest,
  fieldPlanRequest,
  jpegDataUrl,
  verifyRequest,
} from "../../ai/compose";
import type { ChooseInput, ClassifyResult } from "../../ai/provider";
import {
  DECISION_LIMITS,
  estimateDecisionCost,
  estimateStructuredCost,
} from "../../ai/primitives";
import { invalidRequest } from "../../core/http";
import type { Env } from "../../../env";
import type { JobsDb } from "../../repo/core/db";
import type { UserScope } from "../../core/scope";
import { loadFactsAndAnswers } from "../../repo/ai-proxy";
import type { AgentCall } from "./call";
import { assertScreenshot, withoutScreenshot } from "./call";
import { agentFacts, planContext } from "./facts";
import {
  describeCandidate,
  recallObservation,
  rememberObservation,
} from "./observations";
import {
  matchingEstimate,
  matchInputFor,
  matchQuestionsToBank,
  protectedFields,
} from "./questions";
import { planStats, validateFieldPlan } from "./validator";

export interface OperationContext {
  call: AgentCall;
  db: JobsDb;
  email: string;
  env: Pick<Env, "CV_KV">;
  now: number;
  scope: UserScope;
}

// ---------------------------------------------------------------------------
// 19 §4 page classification
// ---------------------------------------------------------------------------

/**
 * Text-only first; when the confidence is below 0.85 and the CLI attached a
 * screenshot, one retry with the image (19 §4.3). Most steps never send an
 * image to the provider.
 */
export async function pageClassify(
  op: OperationContext,
  body: PageClassifyRequest
): Promise<PageClassifyResponse> {
  const { call } = op;
  const observation = body.observation;
  assertScreenshot(observation.screenshot_jpeg_b64);
  rememberObservation(
    op.scope.userId,
    call.lease.lease_id,
    observation,
    op.now
  );
  const hasImage = observation.screenshot_jpeg_b64 !== null;
  await call.budget(
    estimateDecisionCost(classifyRequest({ observation })) +
      (hasImage
        ? estimateDecisionCost(
            classifyRequest({ observation, withScreenshot: true })
          )
        : 0)
  );
  let result: ClassifyResult = await call.ai.classifyPage({ observation });
  call.meter.add(result.usage, result.calls);
  if (hasImage && result.confidence < AGENT_THRESHOLDS.screenshotRetry) {
    const retry = await call.ai.classifyPage({
      observation,
      withScreenshot: true,
    });
    call.meter.add(retry.usage, retry.calls);
    result = retry.refused.includes("page_kind")
      ? {
          ...result,
          refused: [...new Set([...result.refused, ...retry.refused])],
        }
      : retry;
  }
  return PageClassifyResponseSchema.parse({
    page_kind: result.page_kind,
    confidence: result.confidence,
    probabilities: result.probabilities,
    injection_suspected: result.injection_suspected,
    form_requires_upload: result.form_requires_upload,
    form_present: observation.fields.length > 0,
    refused: result.refused,
  });
}

// ---------------------------------------------------------------------------
// 19 §5 next action
// ---------------------------------------------------------------------------

const RESERVED_CHOICES = new Set(["pause", "stop", "none"]);
/** Candidate ids offered beside pause and stop (≤ 40 choices). */
export const CANDIDATES_OFFERED = DECISION_LIMITS.choicesPerQuestion - 2;

/**
 * Choice among the executor's candidates plus pause / stop. The answer is
 * re-checked against the ids actually offered (19 §5.3 rule 1); thresholds
 * (< 0.70 → pause) are applied by the CLI, which knows the reason.
 */
export async function nextAction(
  op: OperationContext,
  body: NextActionRequest
): Promise<NextActionResponse> {
  const { call } = op;
  const ids = body.candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) {
    throw invalidRequest("candidate ids must be unique");
  }
  if (ids.some((id) => RESERVED_CHOICES.has(id))) {
    throw invalidRequest(
      '"pause", "stop" and "none" are reserved choice values'
    );
  }
  const page = recallObservation(
    op.scope.userId,
    call.lease.lease_id,
    body.observation_id,
    op.now
  );
  const candidates = body.candidates.slice(0, CANDIDATES_OFFERED);
  const input: ChooseInput = {
    candidates,
    descriptions: Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        describeCandidate(candidate, page),
      ])
    ),
    observation: page
      ? {
          url: page.url,
          title: page.title,
          visible_text_excerpt: page.visible_text_excerpt,
        }
      : null,
    pageKind: body.page_kind,
    state: {
      errors: body.state.errors,
      required_remaining: body.state.required_remaining,
      step: body.step,
    },
  };
  await call.budget(estimateDecisionCost(chooseRequest(input)));
  const result = await call.ai.chooseAction(input);
  call.meter.add(result.usage, result.calls);
  const offered = new Set([...candidates.map((c) => c.id), "pause", "stop"]);
  if (result.refused || !offered.has(result.choice)) {
    return { choice: "pause", confidence: null, refused: true };
  }
  return {
    choice: result.choice,
    confidence: result.confidence,
    refused: false,
  };
}

// ---------------------------------------------------------------------------
// 19 §6 field plan
// ---------------------------------------------------------------------------

/**
 * Server-side assembly (19 §6.1): the user's facts and answers, minimized to
 * the visible fields (11 §11); question matching first (19 §6.2); the
 * Responses call (`store: false`, strict schema; attempt 2 escalates the
 * model); then the 19 §6.4 validator decides every value.
 */
export async function fieldPlan(
  op: OperationContext,
  body: FieldPlanRequest
): Promise<FieldPlan> {
  const { call } = op;
  const observation = withoutScreenshot(body.observation);
  assertScreenshot(body.observation.screenshot_jpeg_b64);
  rememberObservation(
    op.scope.userId,
    call.lease.lease_id,
    observation,
    op.now
  );
  if (observation.fields.length === 0) {
    return { items: [], missing: [] };
  }
  const stored = await loadFactsAndAnswers(op.db, op.scope);
  const facts = await agentFacts(
    op.env,
    op.email,
    stored.facts,
    observation.fields
  );
  const protectedRefs = protectedFields(observation.fields);
  const matchInput = matchInputFor(
    observation.fields,
    stored.answers,
    protectedRefs
  );
  const attempt = body.attempt === 2 ? 2 : 1;
  const contextInput = {
    answers: stored.answers,
    facts,
    fields: observation.fields,
    fileSlots: body.file_slots,
    generatedTextAllowed: call.settings.generated_text_allowed,
    requestedKeys: body.fact_keys,
  };
  await call.budget(
    matchingEstimate(matchInput) +
      estimateStructuredCost(
        fieldPlanRequest({
          attempt,
          observation,
          context: planContext({ ...contextInput, hints: [] }),
        })
      )
  );
  const matching = await matchQuestionsToBank(
    call.ai,
    matchInput,
    stored.answers
  );
  call.meter.add(matching.usage, matching.calls);
  const context = planContext({ ...contextInput, hints: matching.hints });
  const result = await call.ai.planFields({ attempt, observation, context });
  call.meter.add(result.usage, result.calls);
  const report = validateFieldPlan(result.plan, {
    observation,
    facts,
    answers: stored.answers,
    hints: matching.hints,
    protectedRefs,
    fileSlots: body.file_slots,
    generatedTextAllowed: call.settings.generated_text_allowed,
    mode: call.lease.mode,
  });
  console.log(
    JSON.stringify({
      evt: "plan_validated",
      task_id: call.lease.task_id,
      attempt,
      refused: result.plan === null,
      dropped_schema_mismatch: report.dropped.length,
      downgraded: report.downgraded,
      ...planStats(report.plan),
    })
  );
  return report.plan;
}

// ---------------------------------------------------------------------------
// 19 §9 verification
// ---------------------------------------------------------------------------

/** Decisions predicates on the evidence, then the 19 §9.1 verdict. */
export async function verifySubmission(
  op: OperationContext,
  body: VerifySubmissionRequest
): Promise<VerifySubmissionResponse> {
  const { call } = op;
  assertScreenshot(body.screenshot_jpeg_b64);
  const input = {
    final_url: body.final_url,
    page_title: body.page_title,
    text_excerpt: body.text_excerpt,
    screenshotDataUrl: jpegDataUrl(body.screenshot_jpeg_b64),
  };
  await call.budget(estimateDecisionCost(verifyRequest(input)));
  const result = await call.ai.verifySubmission(input);
  call.meter.add(result.usage, result.calls);
  const ai = {
    application_received: result.application_received,
    still_form_or_error: result.still_form_or_error,
  };
  return VerifySubmissionResponseSchema.parse({
    ...ai,
    verdict: computeVerificationVerdict(body.signals, ai),
    refused: result.refused,
  });
}
