// `API_ROUTE_SCHEMAS`: every `/api/v1` route of 05, keyed `"METHOD path"`
// with the exact 05 path text. "GET/POST" rows are two keys; "CRUD x[/{id}]"
// rows are GET + POST on the collection and GET + PATCH + DELETE on the item.
import { aiRoutes } from "./ai";
import { analyticsRoutes } from "./analytics";
import { applicationsRoutes } from "./applications";
import { automationRoutes } from "./automation";
import { cvRoutes } from "./cv";
import { devicesRoutes } from "./devices";
import { discoveryRoutes } from "./discovery";
import { emailRoutes } from "./email";
import { metaRoutes } from "./meta";
import { profileRoutes } from "./profile";
import type { RouteContract } from "./route";
import { scoringRoutes } from "./scoring";
import { settingsRoutes } from "./settings";
import { syncRoutes } from "./sync";

/** Route contracts in 05 order (§2 … §13). */
export const API_ROUTE_SCHEMAS = {
  ...metaRoutes,
  ...devicesRoutes,
  ...discoveryRoutes,
  ...applicationsRoutes,
  ...scoringRoutes,
  ...cvRoutes,
  ...automationRoutes,
  ...aiRoutes,
  ...profileRoutes,
  ...settingsRoutes,
  ...syncRoutes,
  ...analyticsRoutes,
  ...emailRoutes,
} as const satisfies Record<string, RouteContract>;

export type ApiRouteKey = keyof typeof API_ROUTE_SCHEMAS;

/** The route contracts as a list. */
export const API_ROUTES: readonly RouteContract[] =
  Object.values(API_ROUTE_SCHEMAS);
