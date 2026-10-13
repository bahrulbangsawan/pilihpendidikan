// Jobs tracker endpoints (`/api/jobs`, 05 §14): list (owner-scoped), get,
// create, full-document save and delete, with the request/response shapes
// of the original KV tracker. They are served by the legacy facade
// (src/jobs/legacy): from `JOBS_KV` or from `JOBS_DB` depending on the
// `JOBS_LEGACY_BACKEND` flag (06 §12.5/§12.6).
//
// - Not-found and not-owned both answer 404 so job ids never leak.
// - D-26 (BREAKING for admin tooling): admins get no bypass; `?mine=0` is
//   ignored, every caller sees only their own jobs.
// - Writes need a write-scoped credential.
// - On D1, `PUT` needs no revision but answers 409 when another app changed
//   the job in the last 5 s; an illegal status move is 422 `Invalid status`.

import type { Caller } from "../auth";
import type { Env } from "../env";
import { insufficientScope, jsonError } from "../http";
import { legacyJobs } from "../jobs/legacy/facade";
import { normalizeJobBody } from "../jobs/legacy/mapping";
import type { LegacyContext } from "../jobs/legacy/types";
import { LegacyError } from "../jobs/legacy/types";
import { readJsonBody } from "../json-body";
import type { JobData } from "../types";
import { JOB_STATUSES } from "../types";
import { MAX_DOC_BODY_BYTES } from "./handlers";

function notFound(message: string): Response {
  return jsonError(404, message);
}

function badRequest(message: string): Response {
  return jsonError(400, message);
}

function unprocessable(message: string): Response {
  return jsonError(422, message);
}

function isStatus(value: unknown): value is JobData["status"] {
  return (
    typeof value === "string" &&
    (JOB_STATUSES as readonly string[]).includes(value)
  );
}

function isValidItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.notes === "string" &&
    typeof item.url === "string" &&
    typeof item.done === "boolean"
  );
}

function isValidSection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const section = value as Record<string, unknown>;
  return (
    typeof section.id === "string" &&
    typeof section.name === "string" &&
    Array.isArray(section.items) &&
    section.items.every(isValidItem)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

// A company URL is valid when it is empty (unset) or parses as a URL. Mirrors
// the client-side check and the jobs_create/jobs_update zod `.url()` rule so a
// malformed link is rejected on every write path.
function isValidCompanyUrl(value: unknown): boolean {
  if (typeof value !== "string" || value === "") {
    return true;
  }
  return URL.canParse(value);
}

// Structural validation for create/save payloads from the SPA. Rejects
// malformed bodies so a bad write can never corrupt a job. `id` is checked
// here so the type guard is honest (create reads `body.id`); update overrides
// it with the path id. companyUrl is only checked to be a string here — its URL
// validity is a separate, message-specific check (see companyUrlError).
function isValidJobPayload(value: unknown): value is JobData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === "string" &&
    typeof job.title === "string" &&
    isStatus(job.status) &&
    isOptionalString(job.interviewDate) &&
    isOptionalString(job.company) &&
    isOptionalString(job.companyUrl) &&
    isOptionalString(job.salaryRange) &&
    isOptionalStringArray(job.jobDescription) &&
    isOptionalStringArray(job.requirements) &&
    Array.isArray(job.sections) &&
    job.sections.every(isValidSection)
  );
}

// Returns a 422 when companyUrl is present but not a valid URL, else null.
function companyUrlError(job: JobData): Response | null {
  return isValidCompanyUrl(job.companyUrl)
    ? null
    : unprocessable("Company URL must be a valid URL.");
}

function contextOf(caller: Caller, env: Env): LegacyContext {
  return { caller, env, now: Date.now(), surface: "rest" };
}

// A facade refusal keeps the legacy `{error}` shape and status.
async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LegacyError) {
      return jsonError(err.status, err.message);
    }
    throw err;
  }
}

// Reads and structurally validates a create/save body (400 / 422).
async function readPayload(
  request: Request
): Promise<{ body: JobData } | { error: Response }> {
  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: MAX_DOC_BODY_BYTES });
  } catch {
    return { error: badRequest("Invalid JSON body.") };
  }
  if (!isValidJobPayload(body)) {
    return { error: unprocessable("Invalid job payload.") };
  }
  return { body };
}

// GET /api/jobs — every job the caller owns, newest first. D-26: `?mine=0`
// no longer widens an admin's list.
export async function handleJobsList(
  caller: Caller,
  env: Env,
  _url: URL
): Promise<Response> {
  const jobs = await legacyJobs(contextOf(caller, env));
  const rows = await jobs.list();
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return Response.json({ items: rows });
}

export async function handleJobsGet(
  caller: Caller,
  env: Env,
  jobId: string
): Promise<Response> {
  const jobs = await legacyJobs(contextOf(caller, env));
  const data = await jobs.get(jobId);
  if (!data) {
    return notFound("Job not found.");
  }
  return Response.json({ item: data });
}

// POST /api/jobs — create a new job from a full job document (id generated
// client-side as a UUID). Mirrors the jobs_create MCP tool: a re-create of an
// existing id is rejected (409) and never overwrites another job. The same
// payload + URL validation as update runs first; ownership is the caller's and
// createdAt/updatedAt are server-authoritative.
export function handleJobsCreate(
  caller: Caller,
  env: Env,
  request: Request
): Promise<Response> {
  return guarded(async () => {
    if (caller.scope !== "write") {
      return insufficientScope();
    }
    const payload = await readPayload(request);
    if ("error" in payload) {
      return payload.error;
    }
    const jobId = payload.body.id.trim();
    if (!(jobId && payload.body.title.trim())) {
      return unprocessable("id and title are required.");
    }
    const urlIssue = companyUrlError(payload.body);
    if (urlIssue) {
      return urlIssue;
    }
    const job = normalizeJobBody(payload.body, jobId, new Date().toISOString());
    const jobs = await legacyJobs(contextOf(caller, env));
    const created = await jobs.create(job);
    if (created === "exists") {
      return Response.json(
        { error: `Job "${jobId}" already exists.` },
        { status: 409 }
      );
    }
    return Response.json(
      { ok: true, id: jobId, item: created },
      { status: 201 }
    );
  });
}

// PUT /api/jobs/:id — server-authoritative full-document save (the same
// optimistic-editor pattern CV/invoice use). The job must exist and be the
// caller's (D-26: no admin bypass). The path id is authoritative; createdAt is
// preserved and updatedAt is stamped by the store.
export function handleJobsUpdate(
  caller: Caller,
  env: Env,
  request: Request,
  jobId: string
): Promise<Response> {
  return guarded(async () => {
    if (caller.scope !== "write") {
      return insufficientScope();
    }
    const jobs = await legacyJobs(contextOf(caller, env));
    if (!(await jobs.owns(jobId))) {
      return notFound("Job not found.");
    }
    const payload = await readPayload(request);
    if ("error" in payload) {
      return payload.error;
    }
    const urlIssue = companyUrlError(payload.body);
    if (urlIssue) {
      return urlIssue;
    }
    const next = await jobs.save(jobId, payload.body);
    if (!next) {
      return notFound("Job not found.");
    }
    return Response.json({ ok: true, id: jobId, item: next });
  });
}

// DELETE /api/jobs/:id — the caller's own job only. KV: removes the blob and
// the owner stamp. D1: archives the application (06 §8; never a purge).
export function handleJobsDelete(
  caller: Caller,
  env: Env,
  jobId: string
): Promise<Response> {
  return guarded(async () => {
    if (caller.scope !== "write") {
      return insufficientScope();
    }
    const jobs = await legacyJobs(contextOf(caller, env));
    if (!(await jobs.remove(jobId))) {
      return notFound("Job not found.");
    }
    return Response.json({ ok: true, id: jobId });
  });
}
