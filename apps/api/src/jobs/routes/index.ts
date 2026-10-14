// Every /api/v1 route, aggregated from the area modules (PLAN C4/C5). Each
// area exports `routes: RouteDef[]` from `routes/<area>/index.ts`; adding an
// area means one import and one spread below. Order does not matter for
// matching (the most literal pattern wins), but keep 05 section order.

import type { RouteDef } from "../core/router";
import { buildRouteTable } from "../core/router";
import { routes as accountRoutes } from "./account/index";
import { routes as aiProxyRoutes } from "./ai-proxy/index";
import { routes as analyticsRoutes } from "./analytics/index";
import { routes as applicationsRoutes } from "./applications/index";
import { routes as automationRoutes } from "./automation/index";
import { routes as cloudRoutes } from "./cloud/index";
import { routes as cvRoutes } from "./cv/index";
import { routes as devicesRoutes } from "./devices/index";
import { routes as discoveryRoutes } from "./discovery/index";
import { routes as emailRoutes } from "./email/index";
import { routes as filesRoutes } from "./files/index";
import { routes as metaRoutes } from "./meta/index";
import { routes as profileRoutes } from "./profile/index";
import { routes as scoringRoutes } from "./scoring/index";
import { routes as syncRoutes } from "./sync/index";

/** All declared /api/v1 routes, in 05 section order. */
export const allRoutes: readonly RouteDef[] = [
  ...metaRoutes, // §2
  ...devicesRoutes, // §3
  ...discoveryRoutes, // §4
  ...applicationsRoutes, // §5
  ...scoringRoutes, // §6
  ...filesRoutes, // §7
  ...cvRoutes, // §7
  ...automationRoutes, // §8
  ...aiProxyRoutes, // §9
  ...profileRoutes, // §10
  ...accountRoutes, // §10a
  ...syncRoutes, // §11
  ...analyticsRoutes, // §12
  ...emailRoutes, // §13
  ...cloudRoutes, // §15
];

let table: ReturnType<typeof buildRouteTable> | null = null;

/** The compiled table (built once per isolate). */
export function v1RouteTable(): ReturnType<typeof buildRouteTable> {
  table ??= buildRouteTable(allRoutes);
  return table;
}
