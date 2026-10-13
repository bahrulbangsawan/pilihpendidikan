// The shape of one `/api/v1` route contract (05).
//
// Every area module (one per 05 section) exports a `<area>Routes` object
// keyed `"METHOD /api/v1/…"` with the exact path text of 05 (brace params).
// `API_ROUTE_SCHEMAS` (routes.ts) merges them.
import type { z } from "zod";
import type { OAuthScope } from "../enums";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Response body encodings other than JSON. */
export type BodyEncoding =
  | "json"
  | "multipart/form-data"
  | "text/calendar"
  | "text/html"
  | "binary";

export interface RouteContract {
  /** Additional scopes required together with `scope` (05 "+"). */
  also_requires?: readonly OAuthScope[];
  /** A scope accepted instead of `scope` under the conditions of 05 ("or"). */
  alt_scope?: OAuthScope;
  /** Route needs a device-bound token (CLI under a lease, 17 §5.2). */
  device?: true;
  /** `Idempotency-Key` handling (05 §1.4). */
  idempotency: "required" | "optional" | "none";
  method: HttpMethod;
  /** camelCase operation id; schema names derive from it. */
  operation: string;
  /** Exact 05 path with brace params. */
  path: `/api/v1/${string}`;
  /** Query string schema (values arrive as strings). */
  query?: z.ZodType;
  /** Body schema; null for bodiless POST/PUT/PATCH/DELETE. */
  request: z.ZodType | null;
  request_encoding?: BodyEncoding;
  /** Success body; `null` members mean "no body" (e.g. 204). */
  response: z.ZodType;
  response_encoding?: BodyEncoding;
  /** Primary scope: an OAuth scope, "any" (authenticated) or "none" (public). */
  scope: OAuthScope | "any" | "none";
  /** 05 section, e.g. "05 §5". */
  section: string;
  /** Success status. */
  status: 200 | 201 | 202 | 204;
}

/** Identity helper that keeps the literal types of a route contract. */
export function route<const T extends RouteContract>(contract: T): T {
  return contract;
}

/** `"METHOD path"` key of a route. */
export function routeKey(contract: Pick<RouteContract, "method" | "path">) {
  return `${contract.method} ${contract.path}` as const;
}
