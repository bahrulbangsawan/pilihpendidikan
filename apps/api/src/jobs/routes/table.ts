// The declared /api/v1 surface as data (PLAN C4): what the spec-coverage gate
// (`.unlazy/jobs/checks/spec-api-routes.mjs`), the S-31 isolation sweep and
// the S-32 version-gate test iterate over. Patterns keep the spec's brace
// syntax, e.g. `/api/v1/discovery/runs/{run_id}/postings:batch`.
//
// This module must stay importable from plain `bun` (no `cloudflare:`
// imports anywhere in the route graph).

import type { OAuthScope } from "@pilihpendidikan/jobs-contracts/enums";
import type { HttpMethod, IdempotencyMode, RouteScope } from "../core/router";
import { allRoutes } from "./index";

export interface RouteTableEntry {
  /** Accepted instead of `scope` (05 "or"). */
  alt_scope: OAuthScope | null;
  /** Needed together with `scope` (05 "+"). */
  also_requires: OAuthScope[];
  device: boolean;
  idempotency: IdempotencyMode;
  method: HttpMethod;
  pattern: string;
  rate_limit: string | null;
  scope: RouteScope;
  version_exempt: boolean;
  flag_exempt: boolean;
}

/** One entry per declared route: `{method, pattern, scope, idempotency, device, …}`. */
export function listRouteTable(): RouteTableEntry[] {
  return allRoutes.map((route) => ({
    method: route.method,
    pattern: route.pattern,
    scope: route.scope,
    alt_scope: route.altScope ?? null,
    also_requires: [...(route.alsoRequires ?? [])],
    idempotency: route.idempotency,
    device: route.device === true,
    rate_limit: typeof route.rateLimit === "string" ? route.rateLimit : null,
    version_exempt: route.versionExempt === true,
    flag_exempt: route.flagExempt === true,
  }));
}
