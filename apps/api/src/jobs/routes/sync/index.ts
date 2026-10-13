// Owner: leaf-2.8 — 05 §11 change feed and snapshot (20 §4).
//
//   GET /api/v1/changes?cursor=<seq>&limit=500&entities=a,b
//       {changes: [{seq, entity, entity_id, revision, op, data?}],
//        next_cursor, has_more}; 410 cursor_expired → re-snapshot
//   GET /api/v1/snapshot?entities=applications,rules,…
//       full state + the cursor taken at the start

import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import { readChanges } from "../../services/sync/changes";
import { readSnapshot } from "../../services/sync/snapshot";

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/changes"),
    async handler(c) {
      const page = await readChanges(c.env.DB, c.db, c.scope, c.queryData);
      return c.respond(page);
    },
  }),

  defineRoute({
    ...fromContract("GET /api/v1/snapshot"),
    async handler(c) {
      const snapshot = await readSnapshot(c.db, c.scope, {
        entities: c.queryData.entities,
        now: c.now,
      });
      return c.respond(snapshot);
    },
  }),
];
