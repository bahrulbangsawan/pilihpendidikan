// The BFF's render-ticket mode (08 §6.1/§6.4, PLAN C8). The render page
// authenticates with a single-use ticket instead of the session bearer:
//
//   GET  /api/v1/cv-variants/{cvv_id}?include=cv_data   X-Render-Ticket, once
//   POST /api/v1/files  (kind cv_pdf, links.cv_variant_id) X-Render-Ticket, once
//
// Both calls leave the Worker with the ticket header and **no**
// Authorization header, so a headless CLI page with no session works and a
// signed-in page never mixes its bearer into ticket calls. The ticket never
// comes back to the browser in a response (it is scrubbed like the bearer).
// Pure functions over an injected `fetchApi`; src/functions/render.functions.ts
// wires them to the Worker.

import type { FileUploadMeta } from "@pilihpendidikan/jobs-contracts/api";
import {
  CV_PDF_MAX_BYTES,
  CvVariantDetailSchema,
  FileResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { isId } from "@pilihpendidikan/jobs-contracts/ids";
import type { BffDeps, BffResult, JsonValue } from "./bff";
import { BFF_CLIENT, redactSecret } from "./bff";

export const RENDER_TICKET_HEADER = "X-Render-Ticket";
/** Opaque base64url, ≥ 256 bits (the api mints 43 characters). */
const TICKET_RE = /^[A-Za-z0-9_-]{32,256}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const FILE_NAME_UNSAFE_RE = /[^A-Za-z0-9 ._-]+/g;
const PDF_EXTENSION_RE = /\.pdf$/i;
const DASH_RUN_RE = /-{2,}/g;
const EDGE_JUNK_RE = /^[-. ]+|[-. ]+$/g;
const MAX_ERROR_TEXT = 300;

export function isRenderTicket(value: unknown): value is string {
  return typeof value === "string" && TICKET_RE.test(value);
}

function failure(status: number, error: string, message: string): BffResult {
  return { ok: false, status, error: { error, message } };
}

function ticketHeaders(
  ticket: string,
  clientIp: string | null | undefined
): Headers {
  const headers = new Headers({
    Accept: "application/json",
    [RENDER_TICKET_HEADER]: ticket,
    "X-Pilih-Client": BFF_CLIENT,
  });
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }
  return headers;
}

function parseJson(text: string): unknown {
  try {
    return text.length === 0 ? null : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The api's error envelope (or a status-only stand-in), ticket-free. */
function upstreamError(status: number, json: unknown, text: string): BffResult {
  if (
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof json.error === "string"
  ) {
    const envelope = json as { error: string; message?: unknown };
    return failure(
      status,
      envelope.error,
      typeof envelope.message === "string" ? envelope.message : envelope.error
    );
  }
  return failure(
    status,
    status === 401 ? "invalid_token" : "upstream_unavailable",
    text.slice(0, MAX_ERROR_TEXT) || `HTTP ${status}`
  );
}

async function call(
  deps: Pick<BffDeps, "fetchApi">,
  ticket: string,
  path: string,
  init: RequestInit
): Promise<{ status: number; json: unknown; text: string } | null> {
  let response: Response;
  try {
    response = await deps.fetchApi(path, init);
  } catch {
    return null;
  }
  const text = redactSecret(await response.text(), ticket);
  return { status: response.status, json: parseJson(text), text };
}

export interface RenderReadInput {
  cvv_id: string;
  ticket: string;
}

/**
 * Reads the variant and its tailored CVData with the ticket (its one read).
 * The answer is validated against the contract: the page renders exactly
 * what the schema allows, and a variant without CVData is refused here.
 */
export async function readVariantWithTicket(
  input: unknown,
  deps: Pick<BffDeps, "fetchApi" | "clientIp">
): Promise<BffResult> {
  const candidate = input as Partial<RenderReadInput> | null;
  if (!(candidate && isId("cvv", candidate.cvv_id))) {
    return failure(400, "invalid_request", "Invalid CV variant id.");
  }
  if (!isRenderTicket(candidate.ticket)) {
    return failure(401, "invalid_token", "Missing or malformed render ticket.");
  }
  const { cvv_id: cvvId, ticket } = candidate as RenderReadInput;
  const answer = await call(
    deps,
    ticket,
    `/api/v1/cv-variants/${cvvId}?include=cv_data`,
    { method: "GET", headers: ticketHeaders(ticket, deps.clientIp) }
  );
  if (!answer) {
    return failure(0, "network_error", "The API could not be reached.");
  }
  if (answer.status < 200 || answer.status >= 300) {
    return upstreamError(answer.status, answer.json, answer.text);
  }
  const parsed = CvVariantDetailSchema.safeParse(answer.json);
  if (!parsed.success || parsed.data.cv_variant.id !== cvvId) {
    return failure(502, "upstream_unavailable", "Unexpected variant data.");
  }
  if (!parsed.data.tailored_cv) {
    return failure(422, "no_cv_data", "This variant has no tailored CV yet.");
  }
  return {
    ok: true,
    status: answer.status,
    data: parsed.data as unknown as JsonValue,
    etag: null,
    notModified: false,
    replayed: false,
  };
}

/** Lower-case hex SHA-256 of `bytes` (WebCrypto: Workers, browsers, Node). */
export async function sha256Hex(
  bytes: ArrayBuffer | Uint8Array
): Promise<string> {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  const digest = await crypto.subtle.digest("SHA-256", view as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isPdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** `[A-Za-z0-9 ._-]` only, ≤ 120 characters, always ending in `.pdf`. */
export function safePdfName(raw: string): string {
  const base = raw
    .replace(PDF_EXTENSION_RE, "")
    .replace(FILE_NAME_UNSAFE_RE, "-")
    .replace(DASH_RUN_RE, "-")
    .replace(EDGE_JUNK_RE, "")
    .slice(0, 116);
  return `${base || "cv"}.pdf`;
}

export interface RenderUploadInput {
  bytes: Uint8Array;
  cvvId: string;
  /** Declared by the page; recomputed here and by the api (R2 checks it). */
  sha256: string;
  ticket: string;
  name: string;
}

/** The `multipart/form-data` body the api expects: `meta` (JSON), then `file`. */
export function multipartBody(
  meta: FileUploadMeta,
  file: { name: string; type: string; bytes: Uint8Array },
  boundary: string
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="meta"\r\n' +
      "Content-Type: application/json\r\n\r\n" +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
      `Content-Type: ${file.type}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  return body;
}

function randomBoundary(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `pilih-render-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Uploads the rendered PDF with the ticket (its one upload): checks the
 * bytes are a PDF within the 5 MB cap and match the declared SHA-256 before
 * anything leaves the Worker (08 §6.5; the api repeats every check).
 */
export async function uploadPdfWithTicket(
  input: RenderUploadInput,
  deps: Pick<BffDeps, "fetchApi" | "clientIp">
): Promise<BffResult> {
  if (!isId("cvv", input.cvvId)) {
    return failure(400, "invalid_request", "Invalid CV variant id.");
  }
  if (!isRenderTicket(input.ticket)) {
    return failure(401, "invalid_token", "Missing or malformed render ticket.");
  }
  if (!SHA256_RE.test(input.sha256)) {
    return failure(400, "invalid_request", "Invalid SHA-256.");
  }
  if (input.bytes.length === 0 || input.bytes.length > CV_PDF_MAX_BYTES) {
    return failure(413, "payload_too_large", "The PDF is empty or over 5 MB.");
  }
  if (!isPdf(input.bytes)) {
    return failure(422, "policy_violation", "The file is not a PDF.");
  }
  if ((await sha256Hex(input.bytes)) !== input.sha256) {
    return failure(
      422,
      "policy_violation",
      "The PDF does not match its SHA-256."
    );
  }
  const name = safePdfName(input.name);
  const meta: FileUploadMeta = {
    kind: "cv_pdf",
    sha256: input.sha256,
    content_type: "application/pdf",
    size_bytes: input.bytes.length,
    original_name: name,
    links: { cv_variant_id: input.cvvId },
  };
  const boundary = randomBoundary();
  const headers = ticketHeaders(input.ticket, deps.clientIp);
  headers.set("Content-Type", `multipart/form-data; boundary=${boundary}`);
  // One intent per (variant, bytes): a replay of the same upload is the same.
  headers.set(
    "Idempotency-Key",
    `render:${input.cvvId}:${input.sha256.slice(0, 32)}`
  );
  const answer = await call(deps, input.ticket, "/api/v1/files", {
    method: "POST",
    headers,
    body: multipartBody(
      meta,
      { name, type: "application/pdf", bytes: input.bytes },
      boundary
    ),
  });
  if (!answer) {
    return failure(0, "network_error", "The API could not be reached.");
  }
  if (answer.status < 200 || answer.status >= 300) {
    return upstreamError(answer.status, answer.json, answer.text);
  }
  const parsed = FileResponseSchema.safeParse(answer.json);
  if (!parsed.success || parsed.data.file.sha256 !== input.sha256) {
    return failure(502, "upstream_unavailable", "Unexpected upload answer.");
  }
  return {
    ok: true,
    status: answer.status,
    data: parsed.data as unknown as JsonValue,
    etag: null,
    notModified: false,
    replayed: false,
  };
}
