// Dispatcher for the document API the three apps (and scripts) call:
//
//   GET  /api/whoami                     → {authenticated, email?, isAdmin?, scope?}
//   /api/{cv,invoice,portfolio}[/:id]    → ../documents/handlers.ts
//   /api/jobs[/:id]                      → ../documents/jobs.ts (all authed)
//   GET  /{cv,invoice,portfolio}/:slug.pdf → 302 print view
//
// Precedence: the exact list path first, then `/:id` with an optional
// `.json` / `.pdf` suffix on public GETs. Writes always use the raw `:id`.

import type { Caller } from "../auth";
import { resolveCaller, touchToken } from "../auth";
import type { DocumentKind } from "../documents/kinds";
import { DOCUMENT_SPECS } from "../documents/kinds";
import {
  handleDocumentDelete,
  handleDocumentList,
  handleDocumentUpdate,
  handlePdfRoute,
  handlePublicRead,
} from "../documents/handlers";
import {
  handleJobsCreate,
  handleJobsDelete,
  handleJobsGet,
  handleJobsList,
  handleJobsUpdate,
} from "../documents/jobs";
import type { Env } from "../env";
import {
  jsonError,
  logAuthFailure,
  methodNotAllowed,
  safeDecode,
  unauthorized,
} from "../http";

const DOC_PATH_RE = /^\/api\/(cv|invoice|portfolio)(?:\/([^/]+))?$/;
const DOC_SUFFIX_RE = /^(.+?)\.(json|pdf)$/;
const JOBS_PATH_RE = /^\/api\/jobs(?:\/([^/]+))?$/;
const PDF_ROUTE_RE = /^\/(cv|invoice|portfolio)\/([^/]+?)\.pdf$/;

async function withCaller(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  next: (caller: Caller) => Promise<Response>
): Promise<Response> {
  const result = await resolveCaller(request, env);
  if (!result.caller) {
    await logAuthFailure(request, result.reason);
    return unauthorized(result.reason);
  }
  if (result.tokenId) {
    ctx.waitUntil(touchToken(env.DB, result.tokenId).catch(() => undefined));
  }
  return await next(result.caller);
}

async function handleWhoami(request: Request, env: Env): Promise<Response> {
  const { caller } = await resolveCaller(request, env);
  const body = caller
    ? {
        authenticated: true,
        email: caller.email,
        isAdmin: caller.isAdmin,
        scope: caller.scope,
      }
    : { authenticated: false };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

function splitSuffix(raw: string): { id: string; format: "json" | "pdf" } {
  const match = raw.match(DOC_SUFFIX_RE);
  if (!match) {
    return { id: raw, format: "json" };
  }
  return { id: match[1], format: match[2] === "pdf" ? "pdf" : "json" };
}

function routeDocument(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  match: RegExpMatchArray
): Promise<Response> | Response {
  const spec = DOCUMENT_SPECS[match[1] as DocumentKind];
  const { method } = request;
  if (!match[2]) {
    return method === "GET"
      ? withCaller(request, env, ctx, (caller) =>
          handleDocumentList(caller, env, spec, url)
        )
      : methodNotAllowed("GET, OPTIONS");
  }
  const raw = safeDecode(match[2]);
  if (!raw) {
    return jsonError(400, "Invalid document id.");
  }
  if (method === "GET") {
    const { id, format } = splitSuffix(raw);
    // Portfolio never had a `.pdf` alias under /api.
    if (format === "pdf" && spec.kind === "portfolio") {
      return jsonError(404, "Not found.");
    }
    // The request lets the owner of a private CV read it (D-25).
    return handlePublicRead(env, spec, id, format, url, request);
  }
  if (method === "PUT") {
    return withCaller(request, env, ctx, (caller) =>
      handleDocumentUpdate(caller, env, request, spec, raw)
    );
  }
  if (method === "DELETE") {
    return withCaller(request, env, ctx, (caller) =>
      handleDocumentDelete(caller, env, spec, raw)
    );
  }
  return methodNotAllowed("GET, PUT, DELETE, OPTIONS");
}

function routeJobs(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  match: RegExpMatchArray
): Promise<Response> | Response {
  const { method } = request;
  if (!match[1]) {
    if (method === "GET") {
      return withCaller(request, env, ctx, (c) => handleJobsList(c, env, url));
    }
    if (method === "POST") {
      return withCaller(request, env, ctx, (c) =>
        handleJobsCreate(c, env, request)
      );
    }
    return methodNotAllowed("GET, POST, OPTIONS");
  }
  const jobId = safeDecode(match[1]);
  if (!jobId) {
    return jsonError(400, "Invalid job id.");
  }
  if (method === "GET") {
    return withCaller(request, env, ctx, (c) => handleJobsGet(c, env, jobId));
  }
  if (method === "PUT") {
    return withCaller(request, env, ctx, (c) =>
      handleJobsUpdate(c, env, request, jobId)
    );
  }
  if (method === "DELETE") {
    return withCaller(request, env, ctx, (c) =>
      handleJobsDelete(c, env, jobId)
    );
  }
  return methodNotAllowed("GET, PUT, DELETE, OPTIONS");
}

export function routeDocuments(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> | Response | null {
  const { pathname } = url;
  if (pathname === "/api/whoami") {
    return request.method === "GET"
      ? handleWhoami(request, env)
      : methodNotAllowed("GET, OPTIONS");
  }
  const doc = pathname.match(DOC_PATH_RE);
  if (doc) {
    return routeDocument(request, env, ctx, url, doc);
  }
  const jobs = pathname.match(JOBS_PATH_RE);
  if (jobs) {
    return routeJobs(request, env, ctx, url, jobs);
  }
  const pdf = pathname.match(PDF_ROUTE_RE);
  if (pdf) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed("GET, HEAD");
    }
    const slug = safeDecode(pdf[2]);
    return slug
      ? handlePdfRoute(env, pdf[1] as DocumentKind, slug, url, request)
      : jsonError(400, "Invalid document id.");
  }
  return null;
}
