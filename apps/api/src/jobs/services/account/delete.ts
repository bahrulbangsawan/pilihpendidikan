// Account deletion, request and confirmation (05 §10a, 11 §10).
//
//   POST /api/v1/account/delete  (browser session only)
//        stores a one-time token (`jobs:account-delete:<sha256>` in AUTH_KV,
//        60 min) with the user's choice `also_delete_cvs`, and emails the
//        confirmation link; 202 {status: "confirmation_sent", …}.
//   GET  /api/v1/account/delete/confirm?token=…   (public)
//        a confirm page with ONE button. The GET never deletes anything, so
//        inbox link scanners that prefetch URLs cannot trigger a deletion.
//   POST /api/v1/account/delete/confirm           (public, token in the form
//        or a JSON body) starts the deletion:
//          1. the deletion record (R2 `account-deletions/{user_id}.json`:
//             options + progress; written first, it has no effect alone);
//          2. ONE identity batch: `users.deleted_at` (tombstone: the router
//             answers every credential of the user `401 revoked_token`), every
//             grant (`account_deleted`), refresh token, device and access /
//             personal / session token revoked; KV browser sessions dropped;
//          3. the token is consumed and `purge_user {phase: jobs_db}` sent
//             (a lost message is re-driven by the daily cron).
// The token is the proof of control of the account's email, like a sign-in
// link (which grants the same power); it is 256-bit and stored hashed.

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { ResolvedCaller } from "../../../auth";
import { hashToken, normalizeEmail, randomSecret } from "../../../auth";
import type { Env } from "../../../env";
import { escapeHtml, htmlPage } from "../../../html";
import { publicOrigin } from "../../../origins";
import { upstreamUnavailable } from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  revokeAccountStatements,
  runIdentityStatements,
  sessionTokenHashes,
} from "../../repo/account/identity";
import { findUserById } from "../../repo/core/users";
import { renderDeleteConfirmEmail, sendAccountEmail } from "./email";
import type { DeletionRecord } from "./records";
import { readDeletionRecord, writeDeletionRecord } from "./records";
import { sendJobsMessage } from "./shared";

/** The confirmation link works for 60 minutes. */
export const DELETE_CONFIRM_TTL_SECONDS = 3600;
export const DELETE_CONFIRM_PATH = "/api/v1/account/delete/confirm";
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

interface DeleteTokenRecord {
  also_delete_cvs: boolean;
  email: string;
  requested_at: number;
  user_id: string;
}

async function tokenKey(token: string): Promise<string> {
  return `jobs:account-delete:${await hashToken(token)}`;
}

/** Emails the confirmation link; nothing is deleted yet. */
export async function requestAccountDeletion(
  env: Env,
  request: Request,
  input: {
    alsoDeleteCvs: boolean;
    caller: ResolvedCaller;
    locale: Locale;
    now: number;
    scope: UserScope;
  }
): Promise<{
  confirmation_expires_at: number;
  status: "confirmation_sent";
}> {
  const token = randomSecret();
  const key = await tokenKey(token);
  const record: DeleteTokenRecord = {
    user_id: input.scope.userId,
    email: normalizeEmail(input.caller.email),
    also_delete_cvs: input.alsoDeleteCvs,
    requested_at: input.now,
  };
  await env.AUTH_KV.put(key, JSON.stringify(record), {
    expirationTtl: DELETE_CONFIRM_TTL_SECONDS,
  });
  const link = `${publicOrigin(request)}${DELETE_CONFIRM_PATH}?token=${encodeURIComponent(token)}`;
  try {
    await sendAccountEmail(
      env,
      record.email,
      renderDeleteConfirmEmail({ link, locale: input.locale })
    );
  } catch {
    await env.AUTH_KV.delete(key).catch(() => undefined);
    throw upstreamUnavailable(
      "The confirmation email could not be sent. Try again."
    );
  }
  return {
    status: "confirmation_sent",
    confirmation_expires_at: input.now + DELETE_CONFIRM_TTL_SECONDS * 1000,
  };
}

async function readToken(
  env: Pick<Env, "AUTH_KV">,
  token: string | null
): Promise<DeleteTokenRecord | null> {
  if (!(token && TOKEN_RE.test(token))) {
    return null;
  }
  return await env.AUTH_KV.get<DeleteTokenRecord>(
    await tokenKey(token),
    "json"
  );
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function invalidLinkPage(): Response {
  return htmlPage(
    {
      title: "Link expired",
      body: `<h1>This link has expired</h1>
<section class="card"><p>The account deletion link is no longer valid: it expired, or it was already used. Start again from Settings in the Job Tracker if you still want to delete your account.</p></section>`,
    },
    { status: 410 }
  );
}

/** GET: the confirm page (one button; the GET deletes nothing). */
export async function deletionConfirmPage(
  env: Pick<Env, "AUTH_KV">,
  url: URL
): Promise<Response> {
  const token = url.searchParams.get("token");
  const record = await readToken(env, token);
  if (!(record && token)) {
    return invalidLinkPage();
  }
  const cvs = record.also_delete_cvs
    ? "<li>your CVs (base CVs and tailored variants)</li>"
    : "<li>the tailored CV variants (your base CVs stay)</li>";
  return htmlPage({
    title: "Delete your account",
    body: `<h1>Delete your account?</h1>
<p>This permanently deletes the pilihpendidikan account <strong>${escapeHtml(maskEmail(record.email))}</strong>. It cannot be undone.</p>
<section class="card">
<h2>What is deleted</h2>
<ul class="scopes">
<li>every Job Tracker record: applications, history, interviews, offers, facts, answers, rules, sources, automation runs</li>
<li>your stored files: CV PDFs, letters, evidence screenshots, run logs</li>
${cvs}
<li>every signed-in device, CLI, AI assistant connection and token</li>
</ul>
<form method="post" action="${DELETE_CONFIRM_PATH}">
<input type="hidden" name="token" value="${escapeHtml(token)}" />
<div class="row"><button type="submit" class="danger">Delete my account</button></div>
</form>
</section>
<p class="meta">Changed your mind? Close this page; nothing is deleted.</p>`,
  });
}

export type ConfirmOutcome =
  | { kind: "started"; userId: string }
  | { kind: "already_deleted"; userId: string }
  | { kind: "invalid" };

async function dropSessions(
  env: Pick<Env, "AUTH_KV" | "DB">,
  user: { email: string; id: string }
): Promise<void> {
  const hashes = await sessionTokenHashes(env.DB, user);
  await Promise.all(
    hashes.map((hash) =>
      env.AUTH_KV.delete(`auth:session:${hash}`).catch(() => undefined)
    )
  );
}

/**
 * Revokes every credential and tombstones the account (idempotent). Used by
 * the confirmation and again by the purge, which catches anything minted in
 * between (a sign-in link redeemed meanwhile).
 */
export async function revokeAccount(
  env: Pick<Env, "AUTH_KV" | "DB">,
  user: { email: string; id: string },
  now: number
): Promise<void> {
  await dropSessions(env, user);
  await runIdentityStatements(
    env.DB,
    revokeAccountStatements(env.DB, user, now)
  );
}

/** POST: consumes the token and starts the deletion. */
export async function confirmAccountDeletion(
  env: Env,
  token: string | null,
  now: number
): Promise<ConfirmOutcome> {
  const tokenRecord = await readToken(env, token);
  if (!(tokenRecord && token)) {
    return { kind: "invalid" };
  }
  const user = await findUserById(env.DB, tokenRecord.user_id);
  if (!user || normalizeEmail(user.email) !== tokenRecord.email) {
    await env.AUTH_KV.delete(await tokenKey(token));
    return { kind: "invalid" };
  }
  if (user.deleted_at !== null) {
    await env.AUTH_KV.delete(await tokenKey(token));
    return { kind: "already_deleted", userId: user.id };
  }
  const existing = await readDeletionRecord(env.JOBS_FILES, user.id);
  const record: DeletionRecord = {
    user_id: user.id,
    email: user.email,
    also_delete_cvs:
      tokenRecord.also_delete_cvs || (existing?.also_delete_cvs ?? false),
    requested_at: tokenRecord.requested_at,
    confirmed_at: now,
    phases_done: [],
    completed_at: null,
    redrives: 0,
  };
  await writeDeletionRecord(env.JOBS_FILES, record);
  await revokeAccount(env, user, now);
  await env.AUTH_KV.delete(await tokenKey(token));
  try {
    await sendJobsMessage(env, {
      v: 1,
      type: "purge_user",
      message_id: crypto.randomUUID(),
      user_id: user.id,
      phase: "jobs_db",
    });
  } catch (err) {
    // The account is already closed; the daily cron re-drives the purge.
    console.warn({
      evt: "purge_user_send_failed",
      error: err instanceof Error ? err.name : String(err),
    });
  }
  return { kind: "started", userId: user.id };
}

/** The page answering a confirmation POST. */
export function confirmationResultPage(outcome: ConfirmOutcome): Response {
  if (outcome.kind === "invalid") {
    return invalidLinkPage();
  }
  return htmlPage({
    title: "Account deleted",
    body: `<h1>Your account is being deleted</h1>
<section class="card"><p>Every device, CLI and AI assistant connection is signed out now. Your Job Tracker data, stored files and CVs are removed in the next minutes; backups age out within 30 days.</p></section>
<p class="meta">You can close this page.</p>`,
  });
}
