// 05 §15 — cloud discovery (24): the system catalog of remote-job boards.
// Services: src/jobs/services/cloud/catalog.ts.
//
//   GET    /api/v1/cloud-sources                    jobs:read
//   POST   /api/v1/cloud-sources                    jobs:write  operator (403 operator_required)
//   GET    /api/v1/cloud-sources/{csr_id}           jobs:read
//   PATCH  /api/v1/cloud-sources/{csr_id}           jobs:write  operator, base_revision
//   PUT    /api/v1/cloud-sources/{csr_id}/follow    jobs:write
//   DELETE /api/v1/cloud-sources/{csr_id}/follow    jobs:write
//   GET    /api/v1/cloud-sources/{csr_id}/runs      jobs:read
//   POST   /api/v1/cloud-sources/{csr_id}/runs      jobs:write  operator
//   GET    /api/v1/cloud-discovery/runs             jobs:read
//   POST   /api/v1/cloud-discovery/refresh          jobs:write  operator

import { parsePage } from "../../core/pagination";
import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import {
  createCatalogSource,
  followSource,
  getCatalogDetail,
  listCatalog,
  listDiscoveryRuns,
  listSourceRuns,
  refreshDirectory,
  startCatalogRun,
  unfollowSource,
  updateCatalogSource,
} from "../../services/cloud/catalog";

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/cloud-sources"),
    handler: async (c) => c.respond(await listCatalog(c, c.queryData)),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/cloud-sources"),
    handler: async (c) => c.respond(await createCatalogSource(c, c.body), 201),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/cloud-sources/{csr_id}"),
    handler: async (c) => c.respond(await getCatalogDetail(c, c.params.csr_id)),
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/cloud-sources/{csr_id}"),
    handler: async (c) =>
      c.respond(await updateCatalogSource(c, c.params.csr_id, c.body)),
  }),
  defineRoute({
    ...fromContract("PUT /api/v1/cloud-sources/{csr_id}/follow"),
    handler: async (c) => c.respond(await followSource(c, c.params.csr_id)),
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/cloud-sources/{csr_id}/follow"),
    handler: async (c) => c.respond(await unfollowSource(c, c.params.csr_id)),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/cloud-sources/{csr_id}/runs"),
    handler: async (c) =>
      c.respond(await listSourceRuns(c, c.params.csr_id, parsePage(c.query))),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/cloud-sources/{csr_id}/runs"),
    handler: async (c) =>
      c.respond(await startCatalogRun(c, c.params.csr_id, c.body), 202),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/cloud-discovery/runs"),
    handler: async (c) =>
      c.respond(await listDiscoveryRuns(c, parsePage(c.query))),
  }),
  defineRoute({
    ...fromContract("POST /api/v1/cloud-discovery/refresh"),
    handler: async (c) => c.respond(await refreshDirectory(c), 202),
  }),
];
