// Owner: leaf-2.9 — 05 §13 email applications (09).
//
//   POST /api/v1/applications/{app_id}/emails   jobs:write — draft (web, CLI
//        and MCP); counts toward the `task-create` limit (09 §8, 05 §1.9).
//        201 {email, approval, review}: `review.payload_hash` is what the
//        approve call echoes, plus recipient warnings and the AI paragraph
//        outcome
//   GET  /api/v1/emails/{eml_id}                jobs:read — 200 {email,
//        approval, payload_hash} (`pilih-jobs email show`)
//   POST /api/v1/emails/{eml_id}/approve        automation:manage — 200
//        {email, approval, application, evidence[, delivery]}
//   POST /api/v1/emails/{eml_id}/handed-off     jobs:write — 200
//        {email, application, evidence}

import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import {
  approveEmail,
  getEmailDetail,
  planEmailDraft,
  planHandOff,
} from "../../services/email";
import { CreateEmailDraftSchema } from "../../services/email/drafts";

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("POST /api/v1/applications/{app_id}/emails"),
    body: CreateEmailDraftSchema,
    rateLimit: "task-create",
    async handler(c) {
      const plan = await planEmailDraft(c.db, c.scope, c.params.app_id, {
        body: c.body,
        env: c.env,
        flags: c.flags,
        now: c.now,
        provider: () => c.ai(),
        source: c.changeSource,
      });
      return await c.commit(plan.statements, {
        status: 201,
        body: {
          email: plan.email,
          approval: plan.approval,
          review: plan.review,
        },
      });
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/emails/{eml_id}"),
    async handler(c) {
      return c.respond(
        await getEmailDetail(c.db, c.scope, c.env, c.params.eml_id)
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/emails/{eml_id}/approve"),
    async handler(c) {
      const result = await approveEmail(c.db, c.scope, {
        body: c.body,
        emailId: c.params.eml_id,
        env: c.env,
        flags: c.flags,
        now: c.now,
        source: c.changeSource,
        idempotency: (status, body) => c.idempotencyStatements(status, body),
      });
      if (result.committed) {
        c.markIdempotencyRecorded();
        return c.respond(result.body, 200);
      }
      return await c.commit(result.statements, { body: result.body });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/emails/{eml_id}/handed-off"),
    async handler(c) {
      const plan = await planHandOff(c.db, c.scope, {
        body: c.body,
        emailId: c.params.eml_id,
        env: c.env,
        now: c.now,
        source: c.changeSource,
      });
      return await c.commit(plan.statements, { body: plan.body });
    },
  }),
];
