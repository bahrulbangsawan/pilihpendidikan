// 05 §6 — Scoring (07): enqueue scores and read the current one.
import { defineRoute, fromContract } from "../../core/router";
import type { RouteDef } from "../../core/router";
import { getProfileVersion } from "../../repo/core/profile-version";
import {
  getCurrentScore,
  requestScores,
} from "../../services/scoring/requests";

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("POST /api/v1/scores:request"),
    async handler(c) {
      const profileVersion = await getProfileVersion(c.env, c.db, c.scope, c, {
        email: c.caller.email,
      });
      return c.respond(
        await requestScores(c.env, c.db, c.scope, {
          postingIds: c.body.posting_ids,
          userJobIds: c.body.user_job_ids,
          profileVersion,
          now: c.now,
        })
      );
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/scores/{posting_id}"),
    async handler(c) {
      const profileVersion = await getProfileVersion(c.env, c.db, c.scope, c, {
        email: c.caller.email,
      });
      return await c.respondWithEtag(
        await getCurrentScore(
          c.db,
          c.scope,
          c.params.posting_id,
          profileVersion
        )
      );
    },
  }),
];
