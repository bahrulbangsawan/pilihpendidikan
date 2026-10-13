// 05 §9 — AI proxy (07, 19). Request/response schemas live in agent.ts
// (19 §3–§9); this module only binds them to routes.
import {
  FieldPlanRequestSchema,
  FieldPlanSchema,
  NextActionRequestSchema,
  NextActionResponseSchema,
  PageClassifyRequestSchema,
  PageClassifyResponseSchema,
  VerifySubmissionRequestSchema,
  VerifySubmissionResponseSchema,
} from "../agent";
import { route } from "./route";

export const aiRoutes = {
  "POST /api/v1/ai/page-classify": route({
    method: "POST",
    path: "/api/v1/ai/page-classify",
    operation: "aiPageClassify",
    section: "05 §9",
    scope: "ai:invoke",
    device: true,
    idempotency: "optional",
    status: 200,
    request: PageClassifyRequestSchema,
    response: PageClassifyResponseSchema,
  }),
  "POST /api/v1/ai/next-action": route({
    method: "POST",
    path: "/api/v1/ai/next-action",
    operation: "aiNextAction",
    section: "05 §9",
    scope: "ai:invoke",
    device: true,
    idempotency: "optional",
    status: 200,
    request: NextActionRequestSchema,
    response: NextActionResponseSchema,
  }),
  "POST /api/v1/ai/field-plan": route({
    method: "POST",
    path: "/api/v1/ai/field-plan",
    operation: "aiFieldPlan",
    section: "05 §9",
    scope: "ai:invoke",
    device: true,
    idempotency: "optional",
    status: 200,
    request: FieldPlanRequestSchema,
    response: FieldPlanSchema,
  }),
  "POST /api/v1/ai/verify-submission": route({
    method: "POST",
    path: "/api/v1/ai/verify-submission",
    operation: "aiVerifySubmission",
    section: "05 §9",
    scope: "ai:invoke",
    device: true,
    idempotency: "optional",
    status: 200,
    request: VerifySubmissionRequestSchema,
    response: VerifySubmissionResponseSchema,
  }),
} as const;
