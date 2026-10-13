// Owner: leaf-2.8 — 05 §10 facts and answer bank.
//
//   GET    /api/v1/profile/facts              fact sheet + profile_version
//   PUT    /api/v1/profile/facts              bulk upsert, per-fact base_revision
//   POST   /api/v1/profile/facts:import-cv    proposals from a base CV (no write)
//   GET    /api/v1/profile/answers            answer bank page
//   POST   /api/v1/profile/answers            create (policy, 422 policy_violation)
//   GET    /api/v1/profile/answers/{ans_id}
//   PATCH  /api/v1/profile/answers/{ans_id}   base_revision
//   DELETE /api/v1/profile/answers/{ans_id}   ?base_revision (optional)
//
// A change of the scoring inputs (any fact, a `years_experience.*` answer)
// changes `profile_version`; the new version re-queues scoring lazily
// (07 §2.1) in the background of the request.

import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import { pageOf, parsePage } from "../../core/pagination";
import { baseRevision } from "../../core/revision";
import {
  computeProfileVersion,
  getProfileVersion,
} from "../../repo/core/profile-version";
import { listFacts } from "../../repo/profile/facts";
import { listAnswerRows } from "../../repo/profile/answers";
import {
  planCreateAnswer,
  planDeleteAnswer,
  planUpdateAnswer,
  requireAnswer,
} from "../../services/profile/answers";
import { planPutFacts } from "../../services/profile/facts";
import { importCvProposals } from "../../services/profile/import-cv";
import {
  commitWithReplan,
  scheduleProfileRescore,
  sendRebuildAnalytics,
} from "../../services/profile/shared";

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/profile/facts"),
    async handler(c) {
      const facts = await listFacts(c.db, c.scope);
      const profileVersion = await getProfileVersion(c.env, c.db, c.scope, c, {
        email: c.caller.email,
      });
      return await c.respondWithEtag({
        facts,
        profile_version: profileVersion,
      });
    },
  }),

  defineRoute({
    ...fromContract("PUT /api/v1/profile/facts"),
    async handler(c) {
      const email = c.caller.email;
      const plan = await commitWithReplan(c.db, () =>
        planPutFacts(c.env, c.db, c.scope, {
          email,
          now: c.now,
          request: c.body,
        })
      );
      const profileVersion = await computeProfileVersion(c.env, c.db, c.scope, {
        email,
      });
      if (plan.changed) {
        scheduleProfileRescore(c, { email, profileVersion });
      }
      if (plan.timezoneChanged) {
        await sendRebuildAnalytics(c.env, c.scope, c.requestId);
      }
      // The response depends on the committed state (profile_version), so
      // the idempotency row is recorded after the batch (router fallback);
      // a replayed request converges (`unchanged`) either way.
      return c.respond({
        facts: plan.facts,
        results: plan.results,
        profile_version: profileVersion,
      });
    },
  }),

  defineRoute({
    ...fromContract("POST /api/v1/profile/facts:import-cv"),
    async handler(c) {
      const response = await importCvProposals(c.env, c.db, c.scope, {
        cvId: c.body.cv_id,
        email: c.caller.email,
      });
      return c.respond(response);
    },
  }),

  defineRoute({
    ...fromContract("GET /api/v1/profile/answers"),
    async handler(c) {
      const page = parsePage(c.queryData);
      const rows = await listAnswerRows(c.db, c.scope, page);
      return c.respond(
        pageOf(rows, page.limit, (row) => [row.question_key, row.id])
      );
    },
  }),

  defineRoute({
    ...fromContract("POST /api/v1/profile/answers"),
    async handler(c) {
      const write = planCreateAnswer(c.db, c.scope, c.body, c.now);
      const response = await c.commit(write.statements, {
        status: 201,
        body: { answer: write.answer },
      });
      if (write.affectsProfile) {
        scheduleProfileRescore(c, { email: c.caller.email });
      }
      return response;
    },
  }),

  defineRoute({
    ...fromContract("GET /api/v1/profile/answers/{ans_id}"),
    async handler(c) {
      const answer = await requireAnswer(c.db, c.scope, c.params.ans_id);
      return await c.respondWithEtag({ answer });
    },
  }),

  defineRoute({
    ...fromContract("PATCH /api/v1/profile/answers/{ans_id}"),
    async handler(c) {
      const write = await planUpdateAnswer(c.db, c.scope, {
        id: c.params.ans_id,
        baseRevision: c.baseRevision(c.body.base_revision),
        body: c.body,
        now: c.now,
      });
      if (!write.changed) {
        return c.respond({ answer: write.answer });
      }
      const response = await c.commit(write.statements, {
        body: { answer: write.answer },
      });
      if (write.affectsProfile) {
        scheduleProfileRescore(c, { email: c.caller.email });
      }
      return response;
    },
  }),

  defineRoute({
    ...fromContract("DELETE /api/v1/profile/answers/{ans_id}"),
    async handler(c) {
      const write = await planDeleteAnswer(c.db, c.scope, {
        id: c.params.ans_id,
        baseRevision: baseRevision(c.request, c.queryData.base_revision, {
          optional: true,
        }),
        now: c.now,
      });
      const response = await c.commit(write.statements, {
        body: { id: c.params.ans_id, deleted: true },
      });
      if (write.affectsProfile) {
        scheduleProfileRescore(c, { email: c.caller.email });
      }
      return response;
    },
  }),
];
