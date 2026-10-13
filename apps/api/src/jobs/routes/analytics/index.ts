// Owner: leaf-2.9 — 05 §12 analytics (10). All three routes are `jobs:read`,
// per-user (the caller's scope only, 10 §7) and answer with
// `Cache-Control: private, max-age=60` (10 §6).
//
//   GET /api/v1/analytics/summary?from&to&tz
//   GET /api/v1/analytics/timeseries?metric&interval&from&to&tz
//   GET /api/v1/analytics/breakdown?by&from&to&tz
//
// `from` / `to` are calendar days in `tz` (default: the user's timezone,
// `to` = today, `from` = 90 days earlier); 400 for unknown zones, impossible
// days, from > to or spans over ten years.

import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import {
  ANALYTICS_CACHE_CONTROL,
  getBreakdown,
  getSummary,
  getTimeseries,
} from "../../services/analytics";

const CACHE_HEADERS = { "Cache-Control": ANALYTICS_CACHE_CONTROL };

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/analytics/summary"),
    async handler(c) {
      const body = await getSummary(c.db, c.scope, {
        query: c.queryData,
        now: c.now,
      });
      return c.respond(body, 200, CACHE_HEADERS);
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/analytics/timeseries"),
    async handler(c) {
      const body = await getTimeseries(c.db, c.scope, {
        query: c.queryData,
        now: c.now,
      });
      return c.respond(body, 200, CACHE_HEADERS);
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/analytics/breakdown"),
    async handler(c) {
      const body = await getBreakdown(c.db, c.scope, {
        query: c.queryData,
        now: c.now,
      });
      return c.respond(body, 200, CACHE_HEADERS);
    },
  }),
];
