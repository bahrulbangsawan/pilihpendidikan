// 05 §4 — sources, discovery runs, the postings batch, the inbox and tracked
// jobs. Owner: leaf-2.4. Services: src/jobs/services/discovery/*.
//
//   GET    /api/v1/sources                          jobs:read
//   POST   /api/v1/sources                          jobs:write   (422 unsupported_source, D-17)
//   PATCH  /api/v1/sources/{src_id}                 jobs:write   (base_revision)
//   DELETE /api/v1/sources/{src_id}                 jobs:write
//   GET    /api/v1/sources/adapters                 jobs:read    (adapters.json)
//   POST   /api/v1/discovery/runs                   discovery:write, device-bound
//          (the three run writes share the per-device `sync-batch` limit, 05 §1.9)
//   POST   /api/v1/discovery/runs/{run_id}/postings:batch   discovery:write, the run's device
//   POST   /api/v1/discovery/runs/{run_id}/complete         discovery:write, the run's device
//   GET    /api/v1/discovery/runs                   jobs:read
//   GET    /api/v1/inbox                            jobs:read
//   POST   /api/v1/inbox:bulk                       jobs:write
//   POST   /api/v1/user-jobs                        jobs:write
//   GET    /api/v1/user-jobs/{ujb_id}               jobs:read

import {
  POSTINGS_BATCH_MAX_BYTES,
  POSTINGS_BATCH_MAX_ITEMS,
} from "@pilihpendidikan/jobs-contracts/api";
import { ADAPTERS_FILE } from "@pilihpendidikan/jobs-contracts/adapters";
import { z } from "zod";
import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import { postPostingsBatch } from "../../services/discovery/batch";
import { listInbox, inboxBulk } from "../../services/discovery/inbox";
import { addUserJob, getUserJobDetail } from "../../services/discovery/index";
import {
  completeRun,
  createRun,
  listRunsPage,
} from "../../services/discovery/runs";
import {
  createSource,
  deleteSource,
  listSourcesPage,
  updateSource,
} from "../../services/discovery/sources";

/**
 * The batch envelope only: items are validated one by one by the service so
 * a bad item is an `invalid` outcome, not a failed batch (05 §4).
 */
const PostingsBatchEnvelopeSchema = z.object({
  items: z.array(z.unknown()).min(1).max(POSTINGS_BATCH_MAX_ITEMS),
});

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/sources"),
    handler: (c) => listSourcesPage(c, c.queryData),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/sources"),
    handler: (c) => createSource(c, c.body),
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/sources/{src_id}"),
    handler: (c) => updateSource(c, c.params.src_id, c.body),
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/sources/{src_id}"),
    handler: (c) => deleteSource(c, c.params.src_id, c.queryData),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/sources/adapters"),
    handler: (c) => c.respondWithEtag(ADAPTERS_FILE),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/discovery/runs"),
    device: true,
    rateLimit: "sync-batch",
    handler: (c) => createRun(c, c.body),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/discovery/runs/{run_id}/postings:batch"),
    device: true,
    rateLimit: "sync-batch",
    body: PostingsBatchEnvelopeSchema,
    maxBodyBytes: POSTINGS_BATCH_MAX_BYTES,
    handler: (c) => postPostingsBatch(c, c.params.run_id, c.body.items),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/discovery/runs/{run_id}/complete"),
    device: true,
    rateLimit: "sync-batch",
    handler: (c) => completeRun(c, c.params.run_id, c.body),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/discovery/runs"),
    handler: (c) => listRunsPage(c),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/inbox"),
    handler: (c) => listInbox(c, c.queryData),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/inbox:bulk"),
    handler: (c) => inboxBulk(c, c.body),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/user-jobs"),
    handler: (c) => addUserJob(c, c.body),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/user-jobs/{ujb_id}"),
    handler: async (c) => c.respond(await getUserJobDetail(c, c.params.ujb_id)),
  }),
];
