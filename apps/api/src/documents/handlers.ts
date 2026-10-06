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

import type { Caller } from "../auth";
import type { Env } from "../env";
import { insufficientScope, jsonError } from "../http";
import { readJsonBody } from "../json-body";
import { appOrigin } from "../origins";
import {
  clearOwner,
  idsOwnedBy,
  listAllKeys,
  ownsDocument,
} from "../ownership";
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

export async function handlePublicRead(
  env: Env,
  spec: DocumentSpec,
  id: string,
  format: "json" | "pdf",
  url: URL
): Promise<Response> {
  const data = await spec.namespace(env).get(`${spec.prefix}${id}`, "json");
  if (data === null) {
    return jsonError(404, `${spec.label} not found`);
  }
  if (format === "pdf") {
    // Legacy `/api/{kind}/<id>.pdf` links → canonical `/{kind}/<id>.pdf`.
    const target = new URL(`/${spec.kind}/${encodeURIComponent(id)}.pdf`, url);
    target.search = url.search;
    return new Response(null, {
      status: 301,
      headers: { Location: target.toString(), "Cache-Control": "no-store" },
    });
  }
  // Never cached: the print view reads it live so a PDF reflects the last save.
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
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
// opens the print dialog. A missing document answers 404, never a redirect.
export async function handlePdfRoute(
  env: Env,
  kind: DocumentKind,
  slug: string,
  url: URL
): Promise<Response> {
  const spec = DOCUMENT_SPECS[kind];
  const exists = await spec.namespace(env).get(`${spec.prefix}${slug}`);
  if (exists === null) {
    return jsonError(404, `${spec.label} not found`);
  }
  const target = `${appOrigin(kind, url)}/?${PRINT_PARAM[kind]}=${encodeURIComponent(slug)}&print=1`;
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}
