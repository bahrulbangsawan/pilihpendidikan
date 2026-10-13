// `profile_version` (07 §2.1, 03 §9): the cache key of match scores. It
// changes whenever an input of the scoring profile changes:
//
//   - every applicant fact (key, revision, updated_at) — covers adds,
//     edits and deletes, and the primary CV pointer `profile.primary_cv_id`;
//   - the `years_experience.*` screening answers;
//   - `user_settings.ai_scoring_sensitive` (changes what the AI may see, 07 §8);
//   - the AI consent (`ai_consent_at IS NOT NULL`, 11 §11.5): scores made
//     without it are deterministic-only, so granting it must re-score;
//   - the content of the primary base CV (`CV_KV cv:{id}`, read only when
//     the caller owns it, `owner:cv:{id}` stamp).
//
// The version is a stable 48-bit integer derived from a SHA-256 of those
// inputs, so it is identical across isolates and needs no stored counter.
// Old `match_scores` rows stay valid for history; readers and automation use
// the row of the CURRENT version (stale scores are re-queued lazily,
// `enqueueProfileRescore`).

import type { Env } from "../../../env";
import { normalizeEmail } from "../../../auth";
import { resolveOwner } from "../../../ownership";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { decodeJson, queryAll, queryFirst } from "./db";
import { findUserById } from "./users";

export const PRIMARY_CV_FACT = "profile.primary_cv_id";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function primaryCvDigest(
  env: Pick<Env, "CV_KV" | "DB">,
  scope: UserScope,
  cvId: string | null,
  email: string | null
): Promise<string> {
  if (!cvId) {
    return "no-cv";
  }
  const ownerEmail =
    email ?? (await findUserById(env.DB, scope.userId))?.email ?? null;
  const owner = await resolveOwner(env as Env, "cv", cvId);
  if (
    !(ownerEmail && owner) ||
    normalizeEmail(owner) !== normalizeEmail(ownerEmail)
  ) {
    return `not-owned:${cvId}`;
  }
  const doc = await env.CV_KV.get(`cv:${cvId}`);
  return doc === null
    ? `missing:${cvId}`
    : `cv:${cvId}:${await sha256Hex(doc)}`;
}

/**
 * The user's current profile version. Pass the caller's email when known
 * (saves the users lookup for the CV ownership check).
 */
export async function computeProfileVersion(
  env: Pick<Env, "CV_KV" | "DB">,
  db: JobsDb,
  scope: UserScope,
  options: { email?: string | null } = {}
): Promise<number> {
  const facts = await queryAll<{
    key: string;
    revision: number;
    updated_at: number;
    value: string;
  }>(
    db,
    "SELECT key, value, revision, updated_at FROM applicant_facts WHERE user_id = ? ORDER BY key",
    scope.userId
  );
  const answers = await queryAll<{
    question_key: string;
    revision: number;
    updated_at: number;
  }>(
    db,
    "SELECT question_key, revision, updated_at FROM screening_answers WHERE user_id = ? AND question_key LIKE 'years_experience.%' ORDER BY question_key",
    scope.userId
  );
  const settings = await queryFirst<{
    ai_consent: number;
    ai_scoring_sensitive: number;
  }>(
    db,
    "SELECT ai_scoring_sensitive, ai_consent_at IS NOT NULL AS ai_consent FROM user_settings WHERE user_id = ?",
    scope.userId
  );
  const primary = facts.find((fact) => fact.key === PRIMARY_CV_FACT);
  const primaryCvId = primary ? decodeJson<unknown>(primary.value, null) : null;
  const cv = await primaryCvDigest(
    env,
    scope,
    typeof primaryCvId === "string" && primaryCvId.length > 0
      ? primaryCvId
      : null,
    options.email ?? null
  );
  const material = JSON.stringify({
    facts: facts.map((f) => [f.key, f.revision, f.updated_at]),
    answers: answers.map((a) => [a.question_key, a.revision, a.updated_at]),
    sensitive: settings?.ai_scoring_sensitive ?? 1,
    consent: settings?.ai_consent === 1,
    cv,
  });
  const hex = await sha256Hex(material);
  // 48 bits keeps it a safe integer (and collisions per user negligible).
  return Number.parseInt(hex.slice(0, 12), 16);
}

const memo = new WeakMap<object, Map<string, Promise<number>>>();

/**
 * `computeProfileVersion`, memoized per request (`memoKey` = any object that
 * lives for the request, e.g. the route context) so several reads in one
 * request compute it once.
 */
export function getProfileVersion(
  env: Pick<Env, "CV_KV" | "DB">,
  db: JobsDb,
  scope: UserScope,
  memoKey: object,
  options: { email?: string | null } = {}
): Promise<number> {
  let perRequest = memo.get(memoKey);
  if (!perRequest) {
    perRequest = new Map();
    memo.set(memoKey, perRequest);
  }
  let version = perRequest.get(scope.userId);
  if (!version) {
    version = computeProfileVersion(env, db, scope, options);
    perRequest.set(scope.userId, version);
  }
  return version;
}
