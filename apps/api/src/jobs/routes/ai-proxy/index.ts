// 05 §9 — AI proxy (07, 19): `ai:invoke`, device-bound tokens only, each call
// bound to a live lease of the calling device. All AI calls of the CLI agent
// go through these four routes (D-12): the CLI never holds a provider key.
import { defineRoute, fromContract } from "../../core/router";
import type { RouteDef } from "../../core/router";
import {
  AI_PROXY_MAX_BODY_BYTES,
  runAgentCall,
} from "../../services/ai-proxy/call";
import type { OperationContext } from "../../services/ai-proxy/operations";
import {
  fieldPlan,
  nextAction,
  pageClassify,
  verifySubmission,
} from "../../services/ai-proxy/operations";
import type { AgentCall } from "../../services/ai-proxy/call";
import type { RouteContext } from "../../core/context";

function operation(
  c: RouteContext<Readonly<Record<string, string>>, unknown, unknown>,
  call: AgentCall
): OperationContext {
  return {
    call,
    db: c.db,
    env: c.env,
    scope: c.scope,
    now: c.now,
    email: c.caller.email,
  };
}

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("POST /api/v1/ai/page-classify"),
    rateLimit: "ai-invoke",
    maxBodyBytes: AI_PROXY_MAX_BODY_BYTES,
    handler: (c) =>
      runAgentCall(c, "page-classify", c.body.lease_ref, (call) =>
        pageClassify(operation(c, call), c.body)
      ),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/ai/next-action"),
    rateLimit: "ai-invoke",
    handler: (c) =>
      runAgentCall(c, "next-action", c.body.lease_ref, (call) =>
        nextAction(operation(c, call), c.body)
      ),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/ai/field-plan"),
    rateLimit: "ai-invoke",
    maxBodyBytes: AI_PROXY_MAX_BODY_BYTES,
    handler: (c) =>
      runAgentCall(c, "field-plan", c.body.lease_ref, (call) =>
        fieldPlan(operation(c, call), c.body)
      ),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/ai/verify-submission"),
    rateLimit: "ai-invoke",
    maxBodyBytes: AI_PROXY_MAX_BODY_BYTES,
    handler: (c) =>
      runAgentCall(c, "verify-submission", c.body.lease_ref, (call) =>
        verifySubmission(operation(c, call), c.body)
      ),
  }),
];
