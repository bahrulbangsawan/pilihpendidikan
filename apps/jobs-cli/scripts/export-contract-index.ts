// Prints the contract index of `packages/jobs-contracts` as JSON for the CLI:
//
// - `routes`: every `/api/v1` route of 05 keyed `"METHOD path"` with its
//   scope, idempotency rule, device flag, status and the registered schema
//   names of its query, request and response;
// - `tables`: table name (04) → record schema name;
// - `schemas`: schema name → JSON Schema group (`schema/<group>.json`, which
//   is the generated module `pilih_jobs.contracts._generated.<group>`).
//
// Called by `scripts/gen_contracts.py`; the output is committed as
// `src/pilih_jobs/contracts/_generated/index.json`. Never edit it by hand.
import { API_ROUTE_SCHEMAS } from "../../../packages/jobs-contracts/src/api/routes";
import { TABLE_RECORDS } from "../../../packages/jobs-contracts/src/records";
import {
  CONTRACT_REGISTRY,
  SCHEMA_GROUPS,
  schemasInGroup,
} from "../../../packages/jobs-contracts/src/registry";
import "../../../packages/jobs-contracts/src/schema-export";

type Part = "query" | "request" | "response";

function nameOf(schema: unknown): string {
  // biome-ignore lint/suspicious/noExplicitAny: registry lookup by instance
  const id = CONTRACT_REGISTRY.get(schema as any)?.id;
  if (!id) {
    throw new Error("unnamed contract schema");
  }
  return id;
}

function partName(route: Record<string, unknown>, part: Part): string | null {
  const schema = route[part];
  return schema === null || schema === undefined ? null : nameOf(schema);
}

const routes: Record<string, unknown> = {};
for (const key of Object.keys(API_ROUTE_SCHEMAS).sort()) {
  const route = API_ROUTE_SCHEMAS[
    key as keyof typeof API_ROUTE_SCHEMAS
  ] as unknown as Record<string, unknown>;
  routes[key] = {
    method: route.method,
    path: route.path,
    operation: route.operation,
    section: route.section,
    scope: route.scope,
    also_requires: route.also_requires ?? [],
    alt_scope: route.alt_scope ?? null,
    idempotency: route.idempotency,
    device: route.device === true,
    status: route.status,
    request_encoding: route.request_encoding ?? "json",
    response_encoding: route.response_encoding ?? "json",
    query: partName(route, "query"),
    request: partName(route, "request"),
    response: partName(route, "response"),
  };
}

const tables: Record<string, string> = {};
for (const table of Object.keys(TABLE_RECORDS).sort()) {
  tables[table] = nameOf(TABLE_RECORDS[table as keyof typeof TABLE_RECORDS]);
}

const schemas: Record<string, string> = {};
for (const group of SCHEMA_GROUPS) {
  for (const name of schemasInGroup(group).keys()) {
    schemas[name] = group;
  }
}
const sortedSchemas: Record<string, string> = {};
for (const name of Object.keys(schemas).sort()) {
  sortedSchemas[name] = schemas[name] as string;
}

process.stdout.write(
  `${JSON.stringify({ routes, tables, schemas: sortedSchemas }, null, 2)}\n`
);
