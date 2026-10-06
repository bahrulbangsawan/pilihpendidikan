// Jobs tracker endpoints: list (owner-scoped), get, create, full-document
// save and delete. Ownership is read from the `owner:job:{id}` stamp through
// ../ownership.ts — the same resolver the MCP ownership guard and jobs_list
// use — so the REST API and MCP clients always agree on which jobs a caller
// sees. A non-admin only sees/edits/deletes their own jobs; admins bypass
// (`?mine=0` widens an admin's list). Not-found and not-owned both answer 404
// so job ids never leak. Writes need a write-scoped credential.

import type { Caller } from "../auth";
import type { Env } from "../env";
import type { JobMetadata } from "../helpers";
import { getJob, putJob } from "../helpers";
import { insufficientScope, jsonError } from "../http";
import { readJsonBody } from "../json-body";
import { jobIdsOwnedBy, listAllKeys, ownsJob } from "../ownership";
import type { JobData } from "../types";
import { JOB_STATUSES } from "../types";
import { MAX_DOC_BODY_BYTES } from "./handlers";

function notFound(message: string): Response {
  return jsonError(404, message);
}

interface JobListRow {
  id: string;
  title: string;
  status: string;
  company: string;
  interviewDate: string;
  updatedAt: string;
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
// malformed bodies so a bad write can never corrupt a job blob. `id` is checked
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

// Coerce a validated payload into a complete JobData with the new fields
// defaulted, the authoritative id, and a fixed createdAt. putJob() re-stamps
// updatedAt. Shared by create (fresh createdAt) and update (preserved).
function normalizeJobBody(
  job: JobData,
  id: string,
  createdAt: string
): JobData {
  return {
    id,
    title: job.title,
    status: job.status,
    company: job.company ?? "",
    companyUrl: job.companyUrl ?? "",
    salaryRange: job.salaryRange ?? "",
    jobDescription: job.jobDescription ?? [],
    requirements: job.requirements ?? [],
    interviewDate: job.interviewDate ?? "",
    sections: job.sections,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function handleJobsList(
  caller: Caller,
  env: Env,
  url: URL
): Promise<Response> {
  const keys = await listAllKeys<Partial<JobMetadata>>(env.JOBS_KV, "job:");
  const toRow = (key: (typeof keys)[number]): JobListRow => ({
    id: key.name.replace("job:", ""),
    title: key.metadata?.title ?? "",
    status: key.metadata?.status ?? "",
    company: key.metadata?.company ?? "",
    interviewDate: key.metadata?.interviewDate ?? "",
    updatedAt: key.metadata?.updatedAt ?? "",
  });
  // Admins default to their own jobs; `?mine=0` widens to every owner's.
  const showAll = caller.isAdmin && url.searchParams.get("mine") === "0";
  let rows: JobListRow[];
  if (showAll) {
    rows = keys.map(toRow);
  } else {
    // Owner-scope from the authoritative `owner:job:{id}` stamp (shared with
    // jobs_list + the MCP ownership guard) — never the KV-list `metadata.owner`
    // mirror, which is "" for MCP-tool writes and would silently hide every
    // MCP-created job from the web UI.
    const owned = await jobIdsOwnedBy(
      env,
      caller.email,
      keys.map((key) => key.name.replace("job:", ""))
    );
    rows = keys
      .filter((key) => owned.has(key.name.replace("job:", "")))
      .map(toRow);
  }
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return Response.json({ items: rows });
}

export async function handleJobsGet(
  caller: Caller,
  env: Env,
  jobId: string
): Promise<Response> {
  const data = await getJob(env.JOBS_KV, jobId);
  if (!(data && (await ownsJob(caller, env, jobId)))) {
    return notFound("Job not found.");
  }
  return Response.json({ item: data });
}

// POST /api/jobs — create a new job from a full job document (id generated
// client-side as a UUID). Mirrors the jobs_create MCP tool: a re-create of an
// existing id is rejected (409) and never overwrites or hijacks another owner's
// job. The same payload + URL validation as update runs first; ownership is
// stamped to the caller and createdAt/updatedAt are server-authoritative.
export async function handleJobsCreate(
  caller: Caller,
  env: Env,
  request: Request
): Promise<Response> {
  if (caller.scope !== "write") {
    return insufficientScope();
  }
  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: MAX_DOC_BODY_BYTES });
  } catch {
    return badRequest("Invalid JSON body.");
  }
  if (!isValidJobPayload(body)) {
    return unprocessable("Invalid job payload.");
  }
  const jobId = body.id.trim();
  if (!(jobId && body.title.trim())) {
    return unprocessable("id and title are required.");
  }
  const urlIssue = companyUrlError(body);
  if (urlIssue) {
    return urlIssue;
  }
  const existing = await getJob(env.JOBS_KV, jobId);
  if (existing) {
    return Response.json(
      { error: `Job "${jobId}" already exists.` },
      { status: 409 }
    );
  }
  const job = normalizeJobBody(body, jobId, new Date().toISOString());
  await putJob(env.JOBS_KV, jobId, job, caller.email);
  await env.JOBS_KV.put(`owner:job:${jobId}`, caller.email);
  return Response.json({ ok: true, id: jobId, item: job }, { status: 201 });
}

// PUT /api/jobs/:id — server-authoritative full-document save (the same
// optimistic-editor pattern CV/invoice use). The job must already exist and be
// owned by the caller (admins bypass). The path id is authoritative; createdAt
// is preserved from the stored blob and putJob() stamps updatedAt.
export async function handleJobsUpdate(
  caller: Caller,
  env: Env,
  request: Request,
  jobId: string
): Promise<Response> {
  if (caller.scope !== "write") {
    return insufficientScope();
  }
  const existing = await getJob(env.JOBS_KV, jobId);
  if (!(existing && (await ownsJob(caller, env, jobId)))) {
    return notFound("Job not found.");
  }
  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: MAX_DOC_BODY_BYTES });
  } catch {
    return badRequest("Invalid JSON body.");
  }
  if (!isValidJobPayload(body)) {
    return unprocessable("Invalid job payload.");
  }
  const urlIssue = companyUrlError(body);
  if (urlIssue) {
    return urlIssue;
  }
  const next = normalizeJobBody(body, jobId, existing.createdAt);
  // Preserve the real owner in metadata (an admin may be editing another
  // user's job — stamping caller.email would mis-attribute ownership).
  const owner = (await env.JOBS_KV.get(`owner:job:${jobId}`)) ?? caller.email;
  await putJob(env.JOBS_KV, jobId, next, owner);
  return Response.json({ ok: true, id: jobId, item: next });
}

// DELETE /api/jobs/:id — owner-or-admin (a user manages their own jobs, unlike
// the admin-only CV/invoice delete). Removes both the blob and the owner stamp.
export async function handleJobsDelete(
  caller: Caller,
  env: Env,
  jobId: string
): Promise<Response> {
  if (caller.scope !== "write") {
    return insufficientScope();
  }
  const existing = await getJob(env.JOBS_KV, jobId);
  if (!(existing && (await ownsJob(caller, env, jobId)))) {
    return notFound("Job not found.");
  }
  await env.JOBS_KV.delete(`job:${jobId}`);
  await env.JOBS_KV.delete(`owner:job:${jobId}`);
  return Response.json({ ok: true, id: jobId });
}
