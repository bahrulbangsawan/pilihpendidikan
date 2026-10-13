// The `/api/v1` routes the web app may call through the BFF, typed from the
// shared contracts (D-20, `API_ROUTE_SCHEMAS`). Every request and response the
// app sends or reads is a `z.input` / `z.output` of a contract schema.
//
// Left out on purpose (src/lib/api-routes.test.ts keeps the list exhaustive):
// device-bound CLI routes (claims, leases, heartbeats, late evidence), the AI
// proxy (lease-bound), discovery writes (`discovery:write`, the CLI's job),
// device registration, anonymous telemetry, and the two non-JSON routes
// (`.ics`, file content), which the `/download/*` server route streams.

import type { ApiRouteKey } from "@pilihpendidikan/jobs-contracts/api";
import { API_ROUTE_SCHEMAS } from "@pilihpendidikan/jobs-contracts/api";
import type { z } from "zod";

export const WEB_ROUTE_KEYS = [
  "GET /api/v1/meta",
  "GET /api/v1/me",
  "GET /api/v1/devices",
  "PATCH /api/v1/devices/{dev_id}",
  "POST /api/v1/devices/{dev_id}/revoke",
  "GET /api/v1/sources",
  "POST /api/v1/sources",
  "PATCH /api/v1/sources/{src_id}",
  "DELETE /api/v1/sources/{src_id}",
  "GET /api/v1/sources/adapters",
  "GET /api/v1/discovery/runs",
  "GET /api/v1/inbox",
  "POST /api/v1/inbox:bulk",
  "POST /api/v1/user-jobs",
  "GET /api/v1/user-jobs/{ujb_id}",
  "GET /api/v1/board",
  "GET /api/v1/applications",
  "POST /api/v1/applications",
  "GET /api/v1/applications/{app_id}",
  "PATCH /api/v1/applications/{app_id}",
  "POST /api/v1/applications/{app_id}/move",
  "POST /api/v1/applications/{app_id}/submission",
  "GET /api/v1/applications/{app_id}/events",
  "POST /api/v1/applications/{app_id}/events",
  "GET /api/v1/applications/{app_id}/interviews",
  "POST /api/v1/applications/{app_id}/interviews",
  "GET /api/v1/applications/{app_id}/interviews/{ivw_id}",
  "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}",
  "DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}",
  "GET /api/v1/applications/{app_id}/offers",
  "POST /api/v1/applications/{app_id}/offers",
  "GET /api/v1/applications/{app_id}/offers/{ofr_id}",
  "PATCH /api/v1/applications/{app_id}/offers/{ofr_id}",
  "DELETE /api/v1/applications/{app_id}/offers/{ofr_id}",
  "DELETE /api/v1/applications/{app_id}",
  "POST /api/v1/scores:request",
  "GET /api/v1/scores/{posting_id}",
  "GET /api/v1/cvs",
  "POST /api/v1/applications/{app_id}/cv-variants",
  "GET /api/v1/cv-variants/{cvv_id}",
  "POST /api/v1/cv-variants/{cvv_id}/render-ticket",
  "POST /api/v1/cv-variants/{cvv_id}/approve",
  "POST /api/v1/cv-variants/{cvv_id}/reject",
  "GET /api/v1/files/{fil_id}",
  "DELETE /api/v1/files/{fil_id}",
  "GET /api/v1/rules",
  "POST /api/v1/rules",
  "GET /api/v1/rules/{rul_id}",
  "PATCH /api/v1/rules/{rul_id}",
  "DELETE /api/v1/rules/{rul_id}",
  "POST /api/v1/tasks",
  "GET /api/v1/tasks",
  "GET /api/v1/tasks/{tsk_id}",
  "POST /api/v1/tasks/{tsk_id}/cancel",
  "POST /api/v1/tasks/{tsk_id}/retry",
  "POST /api/v1/tasks/{tsk_id}/resume",
  "GET /api/v1/approvals",
  "POST /api/v1/approvals/{apr_id}/decide",
  "GET /api/v1/profile/facts",
  "PUT /api/v1/profile/facts",
  "POST /api/v1/profile/facts:import-cv",
  "GET /api/v1/profile/answers",
  "POST /api/v1/profile/answers",
  "GET /api/v1/profile/answers/{ans_id}",
  "PATCH /api/v1/profile/answers/{ans_id}",
  "DELETE /api/v1/profile/answers/{ans_id}",
  "GET /api/v1/settings",
  "PATCH /api/v1/settings",
  "POST /api/v1/account/export",
  "POST /api/v1/account/delete",
  "GET /api/v1/changes",
  "GET /api/v1/snapshot",
  "GET /api/v1/analytics/summary",
  "GET /api/v1/analytics/timeseries",
  "GET /api/v1/analytics/breakdown",
  "POST /api/v1/applications/{app_id}/emails",
  "POST /api/v1/emails/{eml_id}/approve",
  "POST /api/v1/emails/{eml_id}/handed-off",
  "GET /api/v1/emails/{eml_id}",
] as const satisfies readonly ApiRouteKey[];

export type WebRouteKey = (typeof WEB_ROUTE_KEYS)[number];

/**
 * Contract routes the web never calls, each with the reason. Together with
 * WEB_ROUTE_KEYS they cover every key of API_ROUTE_SCHEMAS (tested).
 */
export const NON_WEB_ROUTE_KEYS: Readonly<
  Partial<Record<ApiRouteKey, string>>
> = {
  "POST /api/v1/devices": "CLI device registration (17 §6)",
  "GET /api/v1/account/exports/{export_id}":
    "binary ZIP: streamed by /download/account/exports/*",
  "GET /api/v1/account/delete/confirm":
    "emailed confirmation page served by apps/api itself",
  "POST /api/v1/account/delete/confirm":
    "emailed confirmation page served by apps/api itself",
  "POST /api/v1/devices/{dev_id}/heartbeat": "device-bound",
  "POST /api/v1/discovery/runs": "discovery:write (CLI)",
  "POST /api/v1/discovery/runs/{run_id}/postings:batch":
    "discovery:write (CLI)",
  "POST /api/v1/discovery/runs/{run_id}/complete": "discovery:write (CLI)",
  "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics":
    "text/calendar: streamed by /download/*",
  "POST /api/v1/files": "multipart upload (render page, CLI)",
  "GET /api/v1/files/{fil_id}/content": "binary: streamed by /download/*",
  "POST /api/v1/devices/{dev_id}/tasks:claim": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/events": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/result": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/release": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence": "device-bound",
  "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals": "device-bound",
  "GET /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}":
    "device-bound",
  "POST /api/v1/ai/page-classify": "lease-bound AI proxy",
  "POST /api/v1/ai/next-action": "lease-bound AI proxy",
  "POST /api/v1/ai/field-plan": "lease-bound AI proxy",
  "POST /api/v1/ai/verify-submission": "lease-bound AI proxy",
  "POST /api/v1/telemetry": "anonymous CLI telemetry",
  "POST /api/v1/telemetry/crash": "anonymous CLI telemetry",
};

/** Binary / calendar routes the `/download/*` server route may stream. */
export const DOWNLOAD_ROUTE_KEYS = [
  "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics",
  "GET /api/v1/files/{fil_id}/content",
] as const satisfies readonly ApiRouteKey[];

const WEB_ROUTE_SET: ReadonlySet<string> = new Set(WEB_ROUTE_KEYS);

export function isWebRouteKey(value: unknown): value is WebRouteKey {
  return typeof value === "string" && WEB_ROUTE_SET.has(value);
}

type Routes = typeof API_ROUTE_SCHEMAS;
export type RouteOf<K extends ApiRouteKey> = Routes[K];

type ParamNames<P extends string> =
  P extends `${string}{${infer Name}}${infer Rest}`
    ? Name | ParamNames<Rest>
    : never;

export type ApiParams<K extends ApiRouteKey> = {
  [Name in ParamNames<Routes[K]["path"]>]: string;
};
export type ApiResponse<K extends ApiRouteKey> = z.output<
  Routes[K]["response"]
>;
export type ApiBody<K extends ApiRouteKey> =
  Routes[K]["request"] extends z.ZodType
    ? z.input<Routes[K]["request"]>
    : never;
export type ApiQuery<K extends ApiRouteKey> = Routes[K] extends {
  query: infer Query extends z.ZodType;
}
  ? z.input<Query>
  : never;

type ParamsPart<K extends ApiRouteKey> = [
  ParamNames<Routes[K]["path"]>,
] extends [never]
  ? { params?: undefined }
  : { params: ApiParams<K> };
type BodyPart<K extends ApiRouteKey> = Routes[K]["request"] extends z.ZodType
  ? { body: ApiBody<K> }
  : { body?: undefined };
type QueryPart<K extends ApiRouteKey> = Routes[K] extends { query: z.ZodType }
  ? { query?: ApiQuery<K> }
  : { query?: undefined };

/** Everything a call to route `K` needs, typed from its contract. */
export type ApiCallInput<K extends ApiRouteKey> = ParamsPart<K> &
  BodyPart<K> &
  QueryPart<K> & {
    /** Sent as `Idempotency-Key` (05 §1.4); reuse it on retries. */
    idempotencyKey?: string;
    /** Sent as `If-None-Match`; a 304 comes back as `notModified`. */
    ifNoneMatch?: string;
  };

/** Route params are opaque ids: no slashes, dots-only or encoded tricks. */
const PARAM_VALUE_RE = /^[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,199}$/;
const PARAM_NAME_RE = /\{([a-z_]+)\}/g;

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(PARAM_NAME_RE)].map((match) => match[1] ?? "");
}

export function isSafeParamValue(value: string): boolean {
  return PARAM_VALUE_RE.test(value) && !value.includes("..");
}

/**
 * The request path of route `key` with `params` filled in, or null when a
 * param is missing, extra or not a plain id.
 */
export function buildApiPath(
  key: ApiRouteKey,
  params: Readonly<Record<string, string>> = {}
): string | null {
  const contract = API_ROUTE_SCHEMAS[key];
  const names = pathParamNames(contract.path);
  const given = Object.keys(params);
  if (
    given.length !== names.length ||
    given.some((name) => !names.includes(name))
  ) {
    return null;
  }
  let path: string = contract.path;
  for (const name of names) {
    const value = params[name];
    if (value === undefined || !isSafeParamValue(value)) {
      return null;
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  return path;
}

/** Query object → `?a=1&b=x` (undefined / null dropped, stable order). */
export function buildQueryString(
  query: Readonly<Record<string, unknown>> | undefined
): string {
  if (!query) {
    return "";
  }
  const search = new URLSearchParams();
  for (const name of Object.keys(query).sort()) {
    const value = query[name];
    if (value === undefined || value === null) {
      continue;
    }
    search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
