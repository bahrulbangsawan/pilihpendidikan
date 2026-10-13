// Mock api routes for Sources (12 §8, 15 §8/§14): the user's job sources
// (CRUD with revision checks), the adapter registry and the discovery runs.

import type { CreateSourceRequest } from "@pilihpendidikan/jobs-contracts/api";
import {
  ADAPTERS_FILE,
  isAdapterId,
  isExcludedHost,
  parseAdapterConfig,
} from "@pilihpendidikan/jobs-contracts/adapters";
import { EXCLUDED_SOURCE_IDS } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  DiscoveryRunRecord,
  JobSourceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { NOW, USER_ID } from "../../src/test/fixtures";
import { makeRun, makeSource } from "../../src/test/fixtures-rest";
import { fresh, state } from "./state";
import type { MockRequest, MockRoute, Reply } from "./types";
import {
  apiError,
  match,
  NOT_FOUND,
  ok,
  page,
  revisionConflict,
} from "./types";

const HOUR = 3_600_000;
const MINUTE = 60_000;

const deviceId = state.devices[0]?.id ?? newId("dev");
const otherDeviceId = state.devices[1]?.id ?? deviceId;

const acme = fresh(
  makeSource({
    label: "Acme on Greenhouse",
    adapter: "greenhouse",
    config: { board_token: "acme" },
  })
);
const globex = fresh(
  makeSource({
    label: "Globex jobs",
    adapter: "lever",
    config: { site: "globex", region: "global" },
    last_success_at: NOW - 26 * HOUR,
  })
);
const nvidia = fresh(
  makeSource({
    label: "NVIDIA (Workday)",
    adapter: "workday",
    config: {
      tenant: "nvidia",
      wd_host_number: 5,
      site: "NVIDIAExternalCareerSite",
      disabled_reason: "access_denied",
    },
    enabled: false,
    last_success_at: null,
  })
);
const initech = fresh(
  makeSource({
    label: "Initech careers",
    adapter: "career_page",
    config: { url: "https://initech.example/careers" },
    last_success_at: NOW - 3 * HOUR,
  })
);

const completed = fresh(
  makeRun(deviceId, {
    sources: [
      { source_id: acme.id, adapter: "greenhouse", label: acme.label },
      { source_id: initech.id, adapter: "career_page", label: initech.label },
    ],
  })
);
const partial = fresh(
  makeRun(otherDeviceId, {
    status: "partial",
    started_at: NOW - 27 * HOUR,
    finished_at: NOW - 27 * HOUR + 7 * MINUTE,
    sources: [
      { source_id: globex.id, adapter: "lever", label: globex.label },
      { source_id: nvidia.id, adapter: "workday", label: nvidia.label },
    ],
    stats: {
      pages: 6,
      postings_found: 41,
      new: 9,
      updated: 2,
      unchanged: 28,
      duplicates: 1,
      invalid: 1,
      errors_by_class: { access_denied: 1, rate_limited: 2 },
    },
    errors: [
      {
        source_id: nvidia.id,
        source: "workday:nvidia",
        error_class: "access_denied",
        message: "403 Forbidden",
        http_status: 403,
        url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
        at: NOW - 27 * HOUR + 2 * MINUTE,
      },
      {
        source_id: globex.id,
        source: "lever:globex",
        error_class: "rate_limited",
        message: "429 Too Many Requests",
        http_status: 429,
        url: "https://api.lever.co/v0/postings/globex",
        at: NOW - 27 * HOUR + 4 * MINUTE,
      },
      {
        source_id: globex.id,
        source: "lever:globex",
        error_class: "rate_limited",
        http_status: 429,
        at: NOW - 27 * HOUR + 5 * MINUTE,
      },
    ],
  })
);
const running = fresh(
  makeRun(deviceId, {
    status: "running",
    started_at: NOW - 2 * MINUTE,
    finished_at: null,
    sources: [{ source_id: acme.id, adapter: "greenhouse", label: acme.label }],
    stats: { pages: 1, postings_found: 40 },
  })
);

acme.last_run_id = completed.id;
initech.last_run_id = completed.id;
globex.last_run_id = partial.id;
nvidia.last_run_id = partial.id;

const sources = new Map<string, JobSourceRecord>(
  [acme, globex, nvidia, initech].map((source) => [source.id, source])
);
const runs: DiscoveryRunRecord[] = [running, completed, partial];

/** The runs, newest first (also read by the inbox import strip). */
export function discoveryRuns(): DiscoveryRunRecord[] {
  return [...runs].sort((a, b) => b.started_at - a.started_at);
}

export function jobSources(): JobSourceRecord[] {
  return [...sources.values()].sort((a, b) => a.created_at - b.created_at);
}

const SOURCE_RE = /^\/api\/v1\/sources\/([^/]+)$/;

function createSource(body: Record<string, unknown>): Reply {
  const request = body as Partial<CreateSourceRequest>;
  const adapter = String(request.adapter ?? "");
  if ((EXCLUDED_SOURCE_IDS as readonly string[]).includes(adapter)) {
    return apiError(
      422,
      "unsupported_source",
      "This source is not supported (D-17)."
    );
  }
  if (!isAdapterId(adapter)) {
    return apiError(400, "invalid_request", "Unknown adapter.");
  }
  const config = parseAdapterConfig(adapter, request.config ?? {});
  if (!config.success) {
    return apiError(400, "invalid_request", "Invalid config.", {
      issues: config.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      })),
    });
  }
  const url = config.data.url ?? config.data.start_url;
  if (typeof url === "string" && isExcludedHost(url)) {
    return apiError(
      422,
      "unsupported_source",
      "This site is not supported (D-17)."
    );
  }
  const now = Date.now();
  const source: JobSourceRecord = {
    id: newId("src"),
    user_id: USER_ID,
    adapter,
    label: String(request.label ?? adapter),
    config: config.data as JobSourceRecord["config"],
    enabled: request.enabled ?? true,
    schedule: request.schedule ?? null,
    last_run_id: null,
    last_success_at: null,
    cursor_state: {},
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  sources.set(source.id, source);
  return ok({ source }, 201);
}

function updateSource(id: string, body: Record<string, unknown>): Reply {
  const current = sources.get(id);
  if (!current) {
    return NOT_FOUND;
  }
  if (body.base_revision !== current.revision) {
    return revisionConflict(current);
  }
  if (body.config !== undefined) {
    const parsed = parseAdapterConfig(current.adapter, body.config);
    if (!parsed.success) {
      return apiError(400, "invalid_request", "Invalid config.");
    }
  }
  const { base_revision: _ignored, ...changes } = body;
  const next = {
    ...current,
    ...changes,
    revision: current.revision + 1,
    updated_at: Date.now(),
  } as JobSourceRecord;
  sources.set(id, next);
  return ok({ source: next });
}

function deleteSource(request: MockRequest, id: string): Reply {
  const current = sources.get(id);
  if (!current) {
    return NOT_FOUND;
  }
  const base = request.url.searchParams.get("base_revision");
  if (base !== null && Number(base) !== current.revision) {
    return revisionConflict(current);
  }
  sources.delete(id);
  return ok({ id, deleted: true });
}

export const routes: MockRoute[] = [
  (request) => {
    if (request.path !== "/api/v1/sources") {
      return null;
    }
    if (request.method === "GET") {
      const enabled = request.url.searchParams.get("enabled");
      return page(
        jobSources().filter(
          (source) => enabled === null || source.enabled === (enabled === "1")
        )
      );
    }
    return request.method === "POST" ? createSource(request.body) : null;
  },
  (request) =>
    request.method === "GET" && request.path === "/api/v1/sources/adapters"
      ? ok(ADAPTERS_FILE)
      : null,
  (request) => {
    const patch = match(request, "PATCH", SOURCE_RE);
    if (patch) {
      return updateSource(patch[0] ?? "", request.body);
    }
    const remove = match(request, "DELETE", SOURCE_RE);
    return remove ? deleteSource(request, remove[0] ?? "") : null;
  },
  (request) =>
    request.method === "GET" && request.path === "/api/v1/discovery/runs"
      ? page(discoveryRuns())
      : null,
];
