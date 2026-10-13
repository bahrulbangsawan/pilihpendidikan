// Render tickets (08 §6.4, PLAN C8).
//
// `POST /api/v1/cv-variants/{cvv_id}/render-ticket` → `{ticket, url,
// expires_in: 120}`. The ticket is an opaque 256-bit value; only its SHA-256
// is stored: AUTH_KV `jobs:render-ticket:<sha256(ticket)>` → `{user_id,
// cvv_id, read_used, upload_used, expires_at}`, TTL 120 s. It is presented as
// `X-Render-Ticket: <ticket>` (no bearer) on exactly two calls, each once:
//
//   GET  /api/v1/cv-variants/{cvv_id}?include=cv_data      (read_used)
//   POST /api/v1/files  kind=cv_pdf, links.cv_variant_id   (upload_used)
//
// Anything else — another variant, another route, a second use, an expired
// or unknown ticket — is `401 invalid_token`. The authenticator hands the
// router a caller with exactly one scope (`cv:read` or `files:write`) for the
// ticket's user; the upload handler additionally checks the variant link
// (`renderTicketOf(request)`). KV is not transactional, so two requests
// racing with the same ticket inside the same instant could both pass; the
// window is the KV read-modify-write, the blast radius one variant's data.

import type { ResolvedCaller } from "../../../auth";
import type { Env } from "../../../env";
import type { AltAuthenticator } from "../../core/router";
import { invalidToken } from "../../core/http";
import { findUserById } from "../../repo/core/users";
import { sha256Hex } from "./canonical";

/** 08 §6.4: tickets live 120 s. */
export const RENDER_TICKET_TTL_SECONDS = 120;
export const RENDER_TICKET_TTL_MS = RENDER_TICKET_TTL_SECONDS * 1000;
export const RENDER_TICKET_HEADER = "X-Render-Ticket";
const KV_PREFIX = "jobs:render-ticket:";
const TICKET_BYTES = 32;
const KV_MIN_TTL_SECONDS = 60;
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_APP_ORIGIN = "https://jobs.pilihpendidikan.com";
const TRAILING_SLASH_RE = /\/+$/;
const BASE64_PAD_RE = /=+$/;

export type TicketUse = "read" | "upload";

interface TicketRecord {
  cvv_id: string;
  expires_at: number;
  read_used: boolean;
  upload_used: boolean;
  user_id: string;
}

export interface RenderTicketGrant {
  cvvId: string;
  userId: string;
}

export interface IssuedRenderTicket {
  expires_in: number;
  ticket: string;
  url: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PAD_RE, "");
}

async function kvKey(ticket: string): Promise<string> {
  return `${KV_PREFIX}${await sha256Hex(ticket)}`;
}

/** The render page URL of a ticket (C8). */
export function renderPageUrl(
  env: Pick<Env, "JOBS_APP_ORIGIN">,
  cvvId: string,
  ticket: string
): string {
  const origin = (env.JOBS_APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN).replace(
    TRAILING_SLASH_RE,
    ""
  );
  return `${origin}/render/cv/${encodeURIComponent(cvvId)}?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Mints a ticket for one variant of one user (the caller has already checked
 * ownership and the issuing conditions). Also used by the claim context of
 * `render_cv` tasks (21 §5.1).
 */
export async function issueRenderTicket(
  env: Pick<Env, "AUTH_KV" | "JOBS_APP_ORIGIN">,
  grant: RenderTicketGrant & { now: number }
): Promise<IssuedRenderTicket> {
  const ticket = base64Url(
    crypto.getRandomValues(new Uint8Array(TICKET_BYTES))
  );
  const record: TicketRecord = {
    user_id: grant.userId,
    cvv_id: grant.cvvId,
    read_used: false,
    upload_used: false,
    expires_at: grant.now + RENDER_TICKET_TTL_MS,
  };
  await env.AUTH_KV.put(await kvKey(ticket), JSON.stringify(record), {
    expirationTtl: RENDER_TICKET_TTL_SECONDS,
  });
  return {
    ticket,
    url: renderPageUrl(env, grant.cvvId, ticket),
    expires_in: RENDER_TICKET_TTL_SECONDS,
  };
}

const grants = new WeakMap<Request, RenderTicketGrant>();

/** The ticket grant a request was authenticated with (null for bearers). */
export function renderTicketOf(request: Request): RenderTicketGrant | null {
  return grants.get(request) ?? null;
}

// The single request shape each use authorizes (C8).
function allowedRequest(
  request: Request,
  use: TicketUse,
  cvvId: string
): boolean {
  const url = new URL(request.url);
  if (use === "read") {
    return (
      request.method === "GET" &&
      url.pathname === `/api/v1/cv-variants/${cvvId}` &&
      url.searchParams.get("include") === "cv_data"
    );
  }
  return request.method === "POST" && url.pathname === "/api/v1/files";
}

/** Marks one use of a ticket; null when it may not be used for this request. */
export async function consumeRenderTicket(
  env: Pick<Env, "AUTH_KV">,
  request: Request,
  use: TicketUse,
  now: number
): Promise<TicketRecord | null> {
  const ticket = request.headers.get(RENDER_TICKET_HEADER)?.trim() ?? "";
  if (!TICKET_RE.test(ticket)) {
    return null;
  }
  const key = await kvKey(ticket);
  const record = await env.AUTH_KV.get<TicketRecord>(key, "json");
  if (!record || record.expires_at <= now) {
    return null;
  }
  const flag = use === "read" ? "read_used" : "upload_used";
  if (record[flag] || !allowedRequest(request, use, record.cvv_id)) {
    return null;
  }
  const next: TicketRecord = { ...record, [flag]: true };
  if (next.read_used && next.upload_used) {
    await env.AUTH_KV.delete(key);
  } else {
    const ttl = Math.max(
      KV_MIN_TTL_SECONDS,
      Math.ceil((record.expires_at - now) / 1000)
    );
    await env.AUTH_KV.put(key, JSON.stringify(next), { expirationTtl: ttl });
  }
  return record;
}

/**
 * The `altAuth` of the two ticket routes: a caller with the one scope the
 * ticket grants for this request, or 401 `invalid_token`.
 */
export function renderTicketAuth(use: TicketUse): AltAuthenticator {
  return async (request, env, now) => {
    if (!request.headers.has(RENDER_TICKET_HEADER)) {
      return null;
    }
    const record = await consumeRenderTicket(env, request, use, now);
    if (!record) {
      throw invalidToken("unknown_token");
    }
    const user = await findUserById(env.DB, record.user_id);
    if (!user) {
      throw invalidToken("unknown_token");
    }
    grants.set(request, { userId: record.user_id, cvvId: record.cvv_id });
    const caller: ResolvedCaller = {
      email: user.email,
      isAdmin: false,
      scope: use === "read" ? "read" : "write",
      userId: user.id,
      scopes: [use === "read" ? "cv:read" : "files:write"],
      deviceId: null,
      grantId: null,
      credentialKind: "browser_session",
      tokenId: null,
      userDeletedAt: user.deleted_at,
    };
    return caller;
  };
}
