// The /api/v1 router (PLAN C4, 05 §1).
//
// Routes are declared with `defineRoute` in `src/jobs/routes/<area>/index.ts`
// and aggregated by `src/jobs/routes/index.ts`:
//
//   export const routes = [
//     defineRoute({
//       method: "PATCH",
//       pattern: "/api/v1/applications/{app_id}",
//       scope: "jobs:write",
//       idempotency: "optional",
//       body: PatchApplicationRequestSchema,
//       async handler(c) {             // c.params.app_id, c.body typed
//         …
//         return await c.commit(statements, { body: { application } });
//       },
//     }),
//   ];
//
// `fromContract("PATCH /api/v1/applications/{app_id}")` returns the
// method/pattern/scope/idempotency/device/body/query of the contract in
// packages/jobs-contracts so a route cannot drift from it:
//
//   defineRoute({ ...fromContract("GET /api/v1/me"), handler: … })
//
// Dispatch order for a matched route:
//   1. auth            Authorization: Bearer only (no cookies on /api/v1);
//                      401 invalid_token + reason + WWW-Authenticate;
//                      tombstoned users and revoked/foreign devices → 401
//                      revoked_token (skipped for scope "none")
//   2. v1 flag         JOBS_V1_ENABLED off → 404 not_found (except /meta)
//   3. CLI version     X-Pilih-Client: cli/<semver> below
//                      JOBS_MIN_CLI_VERSION → 426 (except /meta)
//   4. scope           403 insufficient_scope + `scope` (05 §1.2)
//   5. device          `device: true` needs a device-bound token → 403
//                      device_required
//   6. rate limit      05 §1.9 rules by name → 429 rate_limited + Retry-After
//   7. body            JSON ≤ 1 MB (413), application/json
//   8. idempotency     Idempotency-Key (≤ 128 printable chars); required
//                      where declared (400); replay → stored response +
//                      `Idempotent-Replayed: true`; other body → 409
//                      idempotency_mismatch
//   9. validation      route `query` / `body` Zod schemas → 400 invalid_request
//                      with details.issues
//  10. handler         thrown ApiError → its envelope; GuardFailedError → 409
//                      revision_conflict; other UNIQUE violations → 409
//                      duplicate; AiProviderError / anything else → 503
//                      upstream_unavailable (logged with the request id)

import type {
  ApiRouteKey,
  RouteContract,
} from "@pilihpendidikan/jobs-contracts/api";
import { API_ROUTE_SCHEMAS } from "@pilihpendidikan/jobs-contracts/api";
import type { OAuthScope } from "@pilihpendidikan/jobs-contracts/enums";
import { z } from "zod";
import type { ResolvedCaller } from "../../auth";
import { resolveCaller, touchToken } from "../../auth";
import type { Env } from "../../env";
import type { V1RateLimit, V1RateLimitName } from "../../rate-limit";
import { checkRateLimits, clientIpFor, V1_RATE_LIMITS } from "../../rate-limit";
import { isAiProviderError } from "../ai/primitives";
import { getAiProvider } from "../ai/provider";
import {
  GuardFailedError,
  jobsDb,
  runBatch,
  UniqueViolationError,
} from "../repo/core/db";
import {
  findIdempotency,
  idempotencyStatements,
  isValidIdempotencyKey,
  requestHash,
} from "../repo/core/idempotency";
import { systemClock } from "./clock";
import type { GrantedVia, IdempotencyInfo, RouteContext } from "./context";
import type { KernelDeps } from "./deps";
import { KernelContext } from "./context";
import type { CallerDevice } from "./device";
import { loadDevice, touchDevicePresence } from "./device";
import type { FeatureFlags } from "./flags";
import { getFeatureFlags } from "./flags";
import {
  ApiError,
  apiError,
  errorResponse,
  insufficientScope,
  invalidRequest,
  invalidToken,
  isApiError,
  notFound,
  rateLimited,
  replayResponse,
  upstreamUnavailable,
  withRequestId,
} from "./http";
import type { UserScope } from "./scope";
import { scopeFromCaller } from "./scope";
import { hasScopes, missingScopes } from "./scopes";
import {
  issuesOf,
  JSON_BODY_LIMIT_BYTES,
  parseJsonBody,
  queryObject,
  readBodyText,
  validateWith,
} from "./validate";
import {
  CLIENT_HEADER,
  cliUpgradeRequired,
  cliVersions,
  parseClientHeader,
} from "./version";

// 401 detail of a deleted account (11 §10 step 6): the only revocation after
// which the CLI wipes its local state (20 §5.3 keeps the outbox otherwise).
const ACCOUNT_DELETED_DETAILS = { revoked_reason: "account_deleted" } as const;

export const V1_PREFIX = "/api/v1";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** One OAuth scope, "any" (authenticated) or "none" (public). */
export type RouteScope = OAuthScope | "any" | "none";
export type IdempotencyMode = "required" | "optional" | "none";

type ParamNames<P extends string> =
  P extends `${string}{${infer K}}${infer Rest}` ? K | ParamNames<Rest> : never;

/** Path params of a brace pattern, e.g. `{app_id: string}`. */
export type ParamsOf<P extends string> = {
  readonly [K in ParamNames<P>]: string;
};

type Output<S> = S extends z.ZodType<infer T> ? T : unknown;

/**
 * A non-bearer credential a route accepts (PLAN C8: the `X-Render-Ticket` of
 * the CV render page). Runs only when the request carries no Authorization
 * header; returns the caller to act as (with the narrow scopes the ticket
 * grants) or null → 401. The scope check, flags and gates still apply.
 */
export type AltAuthenticator = (
  request: Request,
  env: Env,
  now: number
) => Promise<ResolvedCaller | null>;

export interface RouteDefinition<
  P extends string,
  BS extends z.ZodType | "raw" | undefined,
  QS extends z.ZodType | undefined,
> {
  /** Non-bearer credential (render tickets); see `AltAuthenticator`. */
  altAuth?: AltAuthenticator;
  /** Accepted INSTEAD of `scope`, under conditions the handler checks (05 "or"). */
  altScope?: OAuthScope;
  /** Needed together with `scope` (05 "+"). */
  alsoRequires?: readonly OAuthScope[];
  /** Zod schema of the JSON body, or "raw" to leave the body unread. */
  body?: BS;
  /** Needs a device-bound token (403 device_required). */
  device?: true;
  /** Exempt from JOBS_V1_ENABLED (only /api/v1/meta). */
  flagExempt?: true;
  idempotency: IdempotencyMode;
  /** JSON body cap in bytes (default 1 MB). */
  maxBodyBytes?: number;
  method: HttpMethod;
  pattern: P;
  query?: QS;
  rateLimit?: V1RateLimitName | readonly V1RateLimit[];
  scope: RouteScope;
  /** Exempt from the CLI version gate (only /api/v1/meta). */
  versionExempt?: true;
  handler(
    c: RouteContext<
      ParamsOf<P>,
      BS extends z.ZodType ? Output<BS> : unknown,
      Output<QS>
    >
  ): Promise<Response> | Response;
}

/** A declared route with its types erased (what route tables hold). */
export interface RouteDef {
  altAuth?: AltAuthenticator;
  altScope?: OAuthScope;
  alsoRequires?: readonly OAuthScope[];
  body?: z.ZodType | "raw";
  device?: true;
  flagExempt?: true;
  idempotency: IdempotencyMode;
  maxBodyBytes?: number;
  method: HttpMethod;
  pattern: string;
  query?: z.ZodType;
  rateLimit?: V1RateLimitName | readonly V1RateLimit[];
  scope: RouteScope;
  versionExempt?: true;
  handler(c: RouteContext): Promise<Response> | Response;
}

/** Declares a route; `c.params`, `c.body` and `c.queryData` are typed. */
export function defineRoute<
  const P extends string,
  BS extends z.ZodType | "raw" | undefined = undefined,
  QS extends z.ZodType | undefined = undefined,
>(definition: RouteDefinition<P, BS, QS>): RouteDef {
  if (!definition.pattern.startsWith(`${V1_PREFIX}/`)) {
    throw new Error(
      `route pattern must start with ${V1_PREFIX}/: ${definition.pattern}`
    );
  }
  return definition as unknown as RouteDef;
}

type Contract<K extends ApiRouteKey> = (typeof API_ROUTE_SCHEMAS)[K];

type ContractBody<C> = C extends { request_encoding: "multipart/form-data" }
  ? "raw"
  : C extends { request: infer R }
    ? R extends z.ZodType
      ? R
      : undefined
    : undefined;

type ContractQuery<C> = C extends { query: infer Q }
  ? Q extends z.ZodType
    ? Q
    : undefined
  : undefined;

/** The contract-declared half of a route definition (see `fromContract`). */
export interface ContractRoute<K extends ApiRouteKey> {
  altScope?: OAuthScope;
  alsoRequires?: readonly OAuthScope[];
  body: ContractBody<Contract<K>>;
  device?: true;
  idempotency: Contract<K>["idempotency"];
  method: Contract<K>["method"];
  pattern: Contract<K>["path"];
  query: ContractQuery<Contract<K>>;
  scope: Contract<K>["scope"];
}

/**
 * The contract-declared parts of a route (packages/jobs-contracts
 * `API_ROUTE_SCHEMAS`): method, pattern, scope, alt/also scopes, device,
 * idempotency, and the body/query schemas (multipart bodies are "raw").
 */
export function fromContract<K extends ApiRouteKey>(key: K): ContractRoute<K> {
  const contract = API_ROUTE_SCHEMAS[key] as RouteContract;
  const raw = contract.request_encoding === "multipart/form-data";
  let body: z.ZodType | "raw" | undefined;
  if (raw) {
    body = "raw";
  } else if (contract.request) {
    body = contract.request;
  }
  const route: Record<string, unknown> = {
    method: contract.method,
    pattern: contract.path,
    scope: contract.scope,
    idempotency: contract.idempotency,
    body,
    query: contract.query,
  };
  if (contract.alt_scope) {
    route.altScope = contract.alt_scope;
  }
  if (contract.also_requires) {
    route.alsoRequires = contract.also_requires;
  }
  if (contract.device) {
    route.device = true;
  }
  return route as unknown as ContractRoute<K>;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface CompiledRoute {
  literalLength: number;
  paramNames: string[];
  regex: RegExp;
  route: RouteDef;
}

const PARAM_RE = /\{([a-z_][a-z0-9_]*)\}/g;
const REGEX_SPECIAL_RE = /[.*+?^$()|[\]\\]/g;

function compile(route: RouteDef): CompiledRoute {
  const paramNames: string[] = [];
  let source = "";
  let literalLength = 0;
  let last = 0;
  for (const match of route.pattern.matchAll(PARAM_RE)) {
    const literal = route.pattern.slice(last, match.index);
    source += literal.replace(REGEX_SPECIAL_RE, "\\$&");
    literalLength += literal.length;
    source += "([^/]+)";
    paramNames.push(match[1]);
    last = (match.index ?? 0) + match[0].length;
  }
  const tail = route.pattern.slice(last);
  source += tail.replace(REGEX_SPECIAL_RE, "\\$&");
  literalLength += tail.length;
  return { route, regex: new RegExp(`^${source}$`), paramNames, literalLength };
}

export interface RouteTable {
  compiled: CompiledRoute[];
  routes: readonly RouteDef[];
}

/** Compiles a route list; duplicate method + pattern pairs are an error. */
export function buildRouteTable(routes: readonly RouteDef[]): RouteTable {
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method} ${route.pattern}`;
    if (seen.has(key)) {
      throw new Error(`duplicate route ${key}`);
    }
    seen.add(key);
  }
  return { routes, compiled: routes.map(compile) };
}

export type RouteMatch =
  | { kind: "matched"; params: Record<string, string>; route: RouteDef }
  | { allow: string[]; kind: "method_not_allowed" }
  | { kind: "not_found" };

/**
 * Finds the route for a path. When several patterns match, the one with the
 * most literal characters wins (`/sources/adapters` over `/sources/{src_id}`,
 * `/{ivw_id}.ics` over `/{ivw_id}`).
 */
export function matchRoute(
  table: RouteTable,
  method: string,
  pathname: string
): RouteMatch {
  const candidates = table.compiled
    .map((compiled) => ({ compiled, match: compiled.regex.exec(pathname) }))
    .filter((entry) => entry.match !== null)
    .sort((a, b) => b.compiled.literalLength - a.compiled.literalLength);
  if (candidates.length === 0) {
    return { kind: "not_found" };
  }
  const best = candidates[0].compiled.literalLength;
  const top = candidates.filter((c) => c.compiled.literalLength === best);
  const hit = top.find((c) => c.compiled.route.method === method);
  if (!hit?.match) {
    return {
      kind: "method_not_allowed",
      allow: [...new Set(top.map((c) => c.compiled.route.method))],
    };
  }
  const params: Record<string, string> = {};
  for (const [i, name] of hit.compiled.paramNames.entries()) {
    try {
      params[name] = decodeURIComponent(hit.match[i + 1]);
    } catch {
      return { kind: "not_found" };
    }
  }
  return { kind: "matched", route: hit.compiled.route, params };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface Authenticated {
  caller: ResolvedCaller;
  device: CallerDevice | null;
  scope: UserScope;
}

// Bearer header only: /api/v1 never authenticates from cookies.
function withoutCookies(request: Request): Request {
  if (!request.headers.has("Cookie")) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  return new Request(request.url, { method: request.method, headers });
}

async function resolveRouteCaller(
  route: RouteDef,
  request: Request,
  env: Env,
  now: number
): Promise<{ caller: ResolvedCaller; tokenId: string | null }> {
  if (route.altAuth && !request.headers.has("Authorization")) {
    const caller = await route.altAuth(request, env, now);
    if (!caller) {
      throw invalidToken("no_bearer");
    }
    return { caller, tokenId: null };
  }
  const result = await resolveCaller(withoutCookies(request), env);
  if (!result.caller) {
    throw invalidToken(
      result.reason,
      result.revokedReason ? ACCOUNT_DELETED_DETAILS : undefined
    );
  }
  return { caller: result.caller, tokenId: result.tokenId };
}

async function authenticate(
  route: RouteDef,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  now: number
): Promise<Authenticated> {
  const result = await resolveRouteCaller(route, request, env, now);
  const caller = result.caller;
  if (caller.userDeletedAt !== null) {
    throw invalidToken("revoked_token", ACCOUNT_DELETED_DETAILS);
  }
  let device: CallerDevice | null = null;
  if (caller.deviceId) {
    device = await loadDevice(env.DB, caller.deviceId);
    if (
      !device ||
      device.revoked_at !== null ||
      device.user_id !== caller.userId
    ) {
      throw invalidToken("revoked_token");
    }
  }
  if (result.tokenId) {
    ctx.waitUntil(touchToken(env.DB, result.tokenId).catch(() => undefined));
  }
  return { caller, device, scope: scopeFromCaller(caller) };
}

function checkScope(route: RouteDef, caller: ResolvedCaller): GrantedVia {
  if (route.scope === "any") {
    return "any";
  }
  if (route.scope === "none") {
    return "public";
  }
  const also = route.alsoRequires ?? [];
  if (hasScopes(caller.scopes, [route.scope, ...also])) {
    return "scope";
  }
  if (route.altScope && hasScopes(caller.scopes, [route.altScope, ...also])) {
    return "alt_scope";
  }
  throw insufficientScope(missingScopes(caller.scopes, [route.scope, ...also]));
}

async function enforceRateLimit(
  route: RouteDef,
  request: Request,
  env: Env,
  auth: Authenticated | null
): Promise<void> {
  if (!route.rateLimit) {
    return;
  }
  const rules =
    typeof route.rateLimit === "string"
      ? V1_RATE_LIMITS[route.rateLimit]
      : route.rateLimit;
  const bytes = Number(request.headers.get("content-length") ?? "0");
  const checks = rules.map((limit) => {
    let subject = clientIpFor(request);
    if (limit.subject === "user" && auth) {
      subject = `user:${auth.caller.userId}`;
    } else if (limit.subject === "device" && auth) {
      subject = auth.caller.deviceId
        ? `device:${auth.caller.deviceId}`
        : `user:${auth.caller.userId}`;
    }
    const cost =
      limit.costFromBytes && Number.isFinite(bytes) ? Math.max(1, bytes) : 1;
    return [limit.rule, subject, cost] as const;
  });
  const result = await checkRateLimits(env.RATE_LIMIT_KV, checks);
  if (!result.ok) {
    throw rateLimited(result.retryAfterSeconds);
  }
}

function idempotencyKeyOf(route: RouteDef, request: Request): string | null {
  if (!MUTATING.has(request.method) || route.idempotency === "none") {
    return null;
  }
  const key = request.headers.get("Idempotency-Key");
  if (key === null || key === "") {
    if (route.idempotency === "required") {
      throw invalidRequest("This route requires an Idempotency-Key header.");
    }
    return null;
  }
  if (!isValidIdempotencyKey(key)) {
    throw invalidRequest(
      "Idempotency-Key must be 1-128 printable ASCII characters without spaces."
    );
  }
  return key;
}

function renderError(
  err: unknown,
  requestId: string,
  route: RouteDef | null
): Response {
  if (isApiError(err)) {
    return errorResponse(err, requestId);
  }
  if (err instanceof GuardFailedError) {
    return errorResponse(
      apiError(
        "revision_conflict",
        "The resource changed while this request ran. Re-read it and retry.",
        { details: { guard: err.label } }
      ),
      requestId
    );
  }
  if (err instanceof UniqueViolationError) {
    return errorResponse(
      apiError("duplicate", "This record already exists.", {
        details: { constraint: err.constraint },
      }),
      requestId
    );
  }
  if (err instanceof z.ZodError) {
    return errorResponse(
      invalidRequest("Invalid request.", issuesOf(err)),
      requestId
    );
  }
  console.error({
    evt: "v1_error",
    request_id: requestId,
    route: route ? `${route.method} ${route.pattern}` : null,
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    ai: isAiProviderError(err) ? err.kind : undefined,
  });
  return errorResponse(upstreamUnavailable(), requestId);
}

async function readJson(
  route: RouteDef,
  request: Request
): Promise<{ parsed: unknown; text: string }> {
  if (route.body === "raw" || !MUTATING.has(request.method)) {
    return { text: "", parsed: undefined };
  }
  const text = await readBodyText(
    request,
    route.maxBodyBytes ?? JSON_BODY_LIMIT_BYTES
  );
  return {
    text,
    parsed: parseJsonBody(text, request.headers.get("content-type")),
  };
}

function hashInput(
  route: RouteDef,
  request: Request,
  bodyText: string
): string {
  if (route.body === "raw") {
    // Streaming routes are not buffered: bind the key to the declared shape.
    return `${request.headers.get("content-type") ?? ""}|${request.headers.get("content-length") ?? ""}`;
  }
  return bodyText;
}

interface Prepared {
  auth: Authenticated | null;
  flags: FeatureFlags;
  grantedVia: GrantedVia;
}

async function gate(
  route: RouteDef,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  now: number
): Promise<Prepared> {
  const auth =
    route.scope === "none"
      ? null
      : await authenticate(route, request, env, ctx, now);
  const flags = await getFeatureFlags(env, now);
  if (!(flags.JOBS_V1_ENABLED || route.flagExempt)) {
    throw notFound();
  }
  const client = parseClientHeader(request.headers.get(CLIENT_HEADER));
  const versions = cliVersions(env);
  if (!route.versionExempt && cliUpgradeRequired(client, versions.min)) {
    throw new ApiError(
      "cli_upgrade_required",
      `pilih-jobs ${versions.min} or newer is required. Run \`pilih-jobs update\`.`,
      {
        details: {
          client_version: client?.kind === "cli" ? client.version : null,
          min_cli_version: versions.min,
          recommended_cli_version: versions.recommended,
        },
      }
    );
  }
  const grantedVia = auth ? checkScope(route, auth.caller) : "public";
  if (route.device && !auth?.caller.deviceId) {
    throw apiError(
      "device_required",
      "This route needs a token bound to a registered device (pilih-jobs login)."
    );
  }
  if (auth?.device) {
    const device = auth.device;
    ctx.waitUntil(
      touchDevicePresence(env.DB, {
        deviceId: device.id,
        userId: auth.caller.userId,
        now,
        ip: request.headers.get("cf-connecting-ip"),
      }).catch(() => false)
    );
  }
  await enforceRateLimit(route, request, env, auth);
  return { auth, flags, grantedVia };
}

/** Runs one /api/v1 request through the pipeline above. */
export async function dispatchV1(
  table: RouteTable,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: KernelDeps = {}
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const now = (deps.clock ?? systemClock).now();
  const url = new URL(request.url);
  let route: RouteDef | null = null;
  try {
    const match = matchRoute(table, request.method, url.pathname);
    if (match.kind === "not_found") {
      throw notFound("No such API route.");
    }
    if (match.kind === "method_not_allowed") {
      throw new ApiError(
        "invalid_request",
        `Method ${request.method} is not allowed here.`,
        {
          status: 405,
          headers: { Allow: match.allow.join(", ") },
          details: { allow: match.allow },
        }
      );
    }
    route = match.route;
    const { auth, flags, grantedVia } = await gate(
      route,
      request,
      env,
      ctx,
      now
    );
    const db = jobsDb(env);
    const { text, parsed } = await readJson(route, request);
    let idempotency: IdempotencyInfo | null = null;
    const key = auth ? idempotencyKeyOf(route, request) : null;
    if (key && auth) {
      idempotency = {
        key,
        requestHash: await requestHash(
          request.method,
          url.pathname + url.search,
          hashInput(route, request, text)
        ),
      };
      const stored = await findIdempotency(db, auth.scope, key, now);
      if (stored) {
        if (stored.request_hash !== idempotency.requestHash) {
          throw apiError(
            "idempotency_mismatch",
            "This Idempotency-Key was used for a different request."
          );
        }
        return replayResponse(
          stored.status_code,
          stored.response_body,
          requestId
        );
      }
    }
    const queryData = route.query
      ? validateWith(route.query, queryObject(url.searchParams), "query")
      : undefined;
    const body =
      route.body && route.body !== "raw"
        ? validateWith(route.body, parsed, "body")
        : parsed;
    const context = new KernelContext({
      request,
      env,
      ctx,
      url,
      params: match.params,
      body,
      rawBody: parsed,
      queryData,
      caller: auth?.caller ?? null,
      scope: auth?.scope ?? null,
      device: auth?.device ?? null,
      db,
      now,
      requestId,
      client: parseClientHeader(request.headers.get(CLIENT_HEADER)),
      idempotency,
      flags,
      grantedVia,
      ai: () => (deps.ai ?? getAiProvider)(env),
    });
    const response = await route.handler(context);
    await recordFallback(context, response, auth);
    return withRequestId(response, requestId);
  } catch (err) {
    return renderError(err, requestId, route);
  }
}

// A 2xx JSON response to a keyed request whose handler did not store it with
// its mutation (routes writing only R2/KV/queues, or no-op POSTs) is stored
// after the fact so a replay still answers identically. Best effort: losing
// this write only means a replay re-executes.
async function recordFallback(
  context: KernelContext,
  response: Response,
  auth: Authenticated | null
): Promise<void> {
  if (
    !(context.idempotency && auth) ||
    context.idempotencyRecorded ||
    response.status < 200 ||
    response.status >= 300
  ) {
    return;
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.status !== 204 && !type.includes("application/json")) {
    return;
  }
  try {
    const text = response.status === 204 ? "" : await response.clone().text();
    const body = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    const statements = idempotencyStatements(context.db, auth.scope, {
      key: context.idempotency.key,
      requestHash: context.idempotency.requestHash,
      status: response.status,
      body,
      now: context.now,
    });
    await runBatch(context.db, statements);
    context.markIdempotencyRecorded();
  } catch (err) {
    console.warn({
      evt: "idempotency_fallback_failed",
      request_id: context.requestId,
      error: err instanceof Error ? err.name : String(err),
    });
  }
}
