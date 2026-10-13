// The route context the discovery services accept (any params/body/query).

import type { RouteContext } from "../../core/context";

export type DiscoveryContext = RouteContext<unknown, unknown, unknown>;
