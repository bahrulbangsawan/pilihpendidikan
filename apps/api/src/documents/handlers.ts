// REST handlers for the cv / invoice / portfolio documents.
//
//   GET    /api/{kind}            owner-scoped list (auth)
//   GET    /api/{kind}/:id[.json] public JSON read (anyone with the id)
//   GET    /api/{cv|invoice}/:id.pdf → 301 /{kind}/:id.pdf
//   PUT    /api/{kind}/:id        full-document save (owner, write scope)
//   DELETE /api/{kind}/:id        delete + clear owner stamp (owner, write)
//   GET    /{kind}/:slug.pdf      302 to the app's print view
//
// Unauthenticated → 401; authenticated non-owner → 403; read-scoped token on a
// write → 403 insufficient_scope; unknown id → 404.
//
// Private CVs (D-25, 08 §9): a CV stored with `visibility: "private"` (every
// tailored Job Tracker variant) answers 404 on the public JSON read, its
// `.json` / `.pdf` aliases and the `/cv/:slug.pdf` print redirect, unless the
// request carries the owner's own credential (bearer or session cookie; no
// admin bypass). Tailored `-t-` slugs also get `X-Robots-Tag: noindex`. A
// save that omits `visibility` keeps a private document private.

import type { Caller } from "../auth";
import { resolveCaller } from "../auth";
import type { Env } from "../env";
import { insufficientScope, jsonError } from "../http";
import { readJsonBody } from "../json-body";
import { appOrigin } from "../origins";
import {
  clearOwner,
  idsOwnedBy,
  listAllKeys,
  ownsDocument,
  resolveOwner,
} from "../ownership";
import { isPrivateCv, isTailoredCvId } from "./cv-create";
import type { DocumentKind, DocumentSpec } from "./kinds";
import { DOCUMENT_SPECS } from "./kinds";

export const MAX_DOC_BODY_BYTES = 1_048_576; // 1 MB

// The print view reads `?{param}=<slug>&print=1`. cv / invoice keep their
// historical params so old links stay identical; portfolio uses `id`.
const PRINT_PARAM: Readonly<Record<DocumentKind, string>> = {
  cv: "cv",
  invoice: "invoice",
  portfolio: "id",
};

function wantsEveryOwner(caller: Caller, url: URL): boolean {
  return caller.isAdmin && url.searchParams.get("mine") === "0";
}

export async function handleDocumentList(
  caller: Caller,
  env: Env,
  spec: DocumentSpec,
  url: URL
): Promise<Response> {
  const keys = await listAllKeys<Record<string, string>>(
    spec.namespace(env),
    spec.prefix
  );
  const rows = keys.map((key) => ({
    id: key.name.slice(spec.prefix.length),
    ...spec.listRow(key.metadata),
  }));
  if (wantsEveryOwner(caller, url)) {
    return Response.json({ items: rows });
  }
  const owned = await idsOwnedBy(
    env,
    spec.kind,
    caller.email,
    rows.map((row) => row.id)
  );
  return Response.json({ items: rows.filter((row) => owned.has(row.id)) });
}

// D-25: the caller of `request` is the document's owner (stamp = email).
async function requestOwnsDocument(
  request: Request | undefined,
  env: Env,
  kind: DocumentKind,
  id: string
): Promise<boolean> {
  if (!request) {
    return false;
  }
  const { caller } = await resolveCaller(request, env);
  if (!caller) {
    return false;
  }
  return (await resolveOwner(env, kind, id)) === caller.email;
}

function parseStored(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// A private CV is invisible to everyone but its owner (D-25).
async function hiddenFrom(
  request: Request | undefined,
  env: Env,
  kind: DocumentKind,
  id: string,
  data: unknown
): Promise<boolean> {
  if (kind !== "cv" || !isPrivateCv(data)) {
    return false;
  }
  return !(await requestOwnsDocument(request, env, kind, id));
}

/**
 * Public read of one document. `request` (optional) identifies the caller so
 * the owner of a private CV can read it; without it a private CV is 404 for
 * everyone (D-25, fail closed).
 */
export async function handlePublicRead(
  env: Env,
  spec: DocumentSpec,
  id: string,
  format: "json" | "pdf",
  url: URL,
  request?: Request
): Promise<Response> {
  const data = await spec.namespace(env).get(`${spec.prefix}${id}`, "json");
  if (data === null || (await hiddenFrom(request, env, spec.kind, id, data))) {
    return jsonError(404, `${spec.label} not found`);
  }
  const indexing: Record<string, string> =
    spec.kind === "cv" && (isTailoredCvId(id) || isPrivateCv(data))
      ? { "X-Robots-Tag": "noindex" }
      : {};
  if (format === "pdf") {
    // Legacy `/api/{kind}/<id>.pdf` links → canonical `/{kind}/<id>.pdf`.
    const target = new URL(`/${spec.kind}/${encodeURIComponent(id)}.pdf`, url);
    target.search = url.search;
    return new Response(null, {
      status: 301,
      headers: {
        Location: target.toString(),
        "Cache-Control": "no-store",
        ...indexing,
      },
    });
  }
  // Never cached: the print view reads it live so a PDF reflects the last save.
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    ...indexing,
  };
  if (url.searchParams.has("download")) {
    headers["Content-Disposition"] =
      `attachment; filename="${spec.downloadName(data, id)}.json"`;
  }
  return Response.json(data, { headers });
}

async function requireOwnedForWrite(
  caller: Caller,
  env: Env,
  spec: DocumentSpec,
  id: string
): Promise<Response | null> {
  if (caller.scope !== "write") {
    return insufficientScope();
  }
  const existing = await spec.namespace(env).get(`${spec.prefix}${id}`);
  if (existing === null) {
    return jsonError(404, `${spec.label} not found.`);
  }
  if (!(await ownsDocument(caller, env, spec.kind, id))) {
    return jsonError(403, "Forbidden.");
  }
  return null;
}

// D-25: a builder that does not know `visibility` must not publish a private
// CV by saving it. An explicit "public" from the owner still applies.
async function keepPrivate(
  env: Env,
  spec: DocumentSpec,
  id: string,
  data: unknown
): Promise<void> {
  if (spec.kind !== "cv" || typeof data !== "object" || data === null) {
    return;
  }
  const next = data as { visibility?: unknown };
  if (next.visibility !== undefined) {
    return;
  }
  const stored = await spec.namespace(env).get(`${spec.prefix}${id}`, "json");
  if (isPrivateCv(stored)) {
    next.visibility = "private";
  }
}

export async function handleDocumentUpdate(
  caller: Caller,
  env: Env,
  request: Request,
  spec: DocumentSpec,
  id: string
): Promise<Response> {
  const denied = await requireOwnedForWrite(caller, env, spec, id);
  if (denied) {
    return denied;
  }
  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: MAX_DOC_BODY_BYTES });
  } catch (err) {
    const status = (err as { status?: number }).status === 413 ? 413 : 400;
    return jsonError(
      status,
      status === 413 ? "Body too large." : "Invalid JSON body."
    );
  }
  const data = spec.validate(body);
  if (data === null) {
    return jsonError(422, `Invalid ${spec.label.toLowerCase()} payload.`);
  }
  await keepPrivate(env, spec, id, data);
  await spec.save(spec.namespace(env), id, data);
  return Response.json({ ok: true, id, data });
}

export async function handleDocumentDelete(
  caller: Caller,
  env: Env,
  spec: DocumentSpec,
  id: string
): Promise<Response> {
  const denied = await requireOwnedForWrite(caller, env, spec, id);
  if (denied) {
    return denied;
  }
  await spec.namespace(env).delete(`${spec.prefix}${id}`);
  await clearOwner(env, spec.kind, id);
  return Response.json({ ok: true, id });
}

// `/{kind}/<slug>.pdf` → the app's print view, which loads the document and
// opens the print dialog. A missing document answers 404, never a redirect;
// so does a private CV for anyone but its owner (D-25: the redirect is
// refused, the print view could not read it anyway).
export async function handlePdfRoute(
  env: Env,
  kind: DocumentKind,
  slug: string,
  url: URL,
  request?: Request
): Promise<Response> {
  const spec = DOCUMENT_SPECS[kind];
  const stored = await spec.namespace(env).get(`${spec.prefix}${slug}`);
  if (
    stored === null ||
    (await hiddenFrom(request, env, kind, slug, parseStored(stored)))
  ) {
    return jsonError(404, `${spec.label} not found`);
  }
  const target = `${appOrigin(kind, url)}/?${PRINT_PARAM[kind]}=${encodeURIComponent(slug)}&print=1`;
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}
