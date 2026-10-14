// Prefixed ULID identifiers (03 §1, PLAN C2).
//
// Format: `<prefix>_<ULID>`, where the ULID is 26 Crockford base32 characters
// (uppercase, alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ): 10 characters of
// big-endian millisecond timestamp (48 bits, so the first character is 0-7)
// followed by 16 characters of randomness (80 bits). Implemented with plain
// arithmetic so it runs unchanged in Workers, Bun and browsers.
import { z } from "zod";
import { defineSchema } from "./registry";

/** Every id prefix of 00 §7 plus `obs_` (03 §1), with its trailing `_`. */
export const ID_PREFIXES = [
  "usr_",
  "pst_",
  "ujb_",
  "app_",
  "evt_",
  "ivw_",
  "ofr_",
  "scr_",
  "rul_",
  "dev_",
  "grt_",
  "rft_",
  "tsk_",
  "att_",
  "lse_",
  "apr_",
  "evd_",
  "fil_",
  "cvv_",
  "run_",
  "src_",
  "fct_",
  "ans_",
  "eml_",
  "sal_",
  "obs_",
  "csr_",
  "crn_",
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];
/** The prefix without its underscore, e.g. `"app"`. */
export type IdKind = IdPrefix extends `${infer K}_` ? K : never;

/** Entity and table of each prefix (03 §1). */
export const ID_PREFIX_ENTITIES: Readonly<
  Record<IdPrefix, { entity: string; table: string | null }>
> = {
  usr_: { entity: "user", table: "users" },
  pst_: { entity: "posting", table: "job_postings" },
  ujb_: { entity: "user_job", table: "user_jobs" },
  app_: { entity: "application", table: "applications" },
  evt_: { entity: "event", table: "application_events" },
  ivw_: { entity: "interview", table: "interviews" },
  ofr_: { entity: "offer", table: "offers" },
  scr_: { entity: "score", table: "match_scores" },
  rul_: { entity: "rule", table: "automation_rules" },
  dev_: { entity: "device", table: "devices" },
  grt_: { entity: "grant", table: "oauth_grants" },
  rft_: { entity: "refresh_token", table: "oauth_refresh_tokens" },
  tsk_: { entity: "task", table: "automation_tasks" },
  att_: { entity: "attempt", table: "automation_attempts" },
  lse_: { entity: "lease", table: null },
  apr_: { entity: "approval", table: "approvals" },
  evd_: { entity: "evidence", table: "submission_evidence" },
  fil_: { entity: "file", table: "files" },
  cvv_: { entity: "cv_variant", table: "cv_variants" },
  run_: { entity: "run", table: "discovery_runs" },
  src_: { entity: "source", table: "job_sources" },
  fct_: { entity: "fact", table: "applicant_facts" },
  ans_: { entity: "answer", table: "screening_answers" },
  eml_: { entity: "email", table: "email_applications" },
  sal_: { entity: "support_access", table: "support_access_log" },
  obs_: { entity: "observation", table: null },
  csr_: { entity: "cloud_source", table: "cloud_sources" },
  crn_: { entity: "cloud_run", table: "cloud_runs" },
};

/** Crockford base32 alphabet used by ULID. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE = 32;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
/** 2^48 - 1: the largest timestamp a ULID can encode. */
export const ULID_MAX_TIME_MS = 281_474_976_710_655;
/** Servers accept client-generated ids whose time is within ±24 h of now. */
export const ID_MAX_CLOCK_SKEW_MS = 86_400_000;

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const PREFIXED_ID_RE = /^([a-z]{3})_([0-7][0-9A-HJKMNP-TV-Z]{25})$/;

function toPrefix(prefix: IdPrefix | IdKind): IdPrefix {
  const full = (prefix.endsWith("_") ? prefix : `${prefix}_`) as IdPrefix;
  if (!(ID_PREFIXES as readonly string[]).includes(full)) {
    throw new Error(`Unknown id prefix "${prefix}"`);
  }
  return full;
}

/** Encodes a millisecond timestamp as the 10-character ULID time part. */
export function encodeUlidTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > ULID_MAX_TIME_MS) {
    throw new Error(`ULID time out of range: ${ms}`);
  }
  let rest = ms;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i++) {
    const digit = rest % BASE;
    out = `${CROCKFORD_ALPHABET.charAt(digit)}${out}`;
    rest = (rest - digit) / BASE;
  }
  return out;
}

/** Decodes the time part of a canonical ULID, or null when malformed. */
export function decodeUlidTime(ulid: string): number | null {
  if (!ULID_RE.test(ulid)) {
    return null;
  }
  let ms = 0;
  for (const char of ulid.slice(0, TIME_LENGTH)) {
    ms = ms * BASE + CROCKFORD_ALPHABET.indexOf(char);
  }
  return ms;
}

function randomPart(): string {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    // 256 is a multiple of 32, so `byte % 32` is uniform.
    out += CROCKFORD_ALPHABET.charAt(byte % BASE);
  }
  return out;
}

/** A new canonical ULID (26 characters) for `nowMs` (default: now). */
export function newUlid(nowMs: number = Date.now()): string {
  return `${encodeUlidTime(nowMs)}${randomPart()}`;
}

/** A new prefixed id, e.g. `newId("app")` → `app_01JA6V8M3W8Z1T6Q4Y2B7K9C0D`. */
export function newId(prefix: IdPrefix | IdKind, nowMs?: number): string {
  return `${toPrefix(prefix)}${newUlid(nowMs)}`;
}

/** True when `value` is a canonical id with exactly this prefix. */
export function isId(prefix: IdPrefix | IdKind, value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const full = toPrefix(prefix);
  return value.startsWith(full) && ULID_RE.test(value.slice(full.length));
}

/** The prefix of a canonical id, or null for anything else. */
export function idPrefixOf(value: string): IdPrefix | null {
  const match = PREFIXED_ID_RE.exec(value);
  if (!match) {
    return null;
  }
  const prefix = `${match[1]}_`;
  return (ID_PREFIXES as readonly string[]).includes(prefix)
    ? (prefix as IdPrefix)
    : null;
}

/** Millisecond timestamp encoded in a prefixed id (or bare ULID), else null. */
export function idTimestamp(value: string): number | null {
  const match = PREFIXED_ID_RE.exec(value);
  if (match?.[2]) {
    return idPrefixOf(value) ? decodeUlidTime(match[2]) : null;
  }
  return decodeUlidTime(value);
}

/**
 * The ±24 h rule for client-generated ids (03 §1): true when the id is
 * well-formed and its timestamp is within `maxSkewMs` of `nowMs`.
 */
export function isIdWithinClockSkew(
  value: string,
  nowMs: number,
  maxSkewMs: number = ID_MAX_CLOCK_SKEW_MS
): boolean {
  const ts = idTimestamp(value);
  return ts !== null && Math.abs(ts - nowMs) <= maxSkewMs;
}

/** Regex source matching ids of one prefix (anchored). */
export function idPattern(prefix: IdPrefix | IdKind): RegExp {
  return new RegExp(`^${toPrefix(prefix)}[0-7][0-9A-HJKMNP-TV-Z]{25}$`);
}

function idSchema(prefix: IdPrefix, name: string) {
  return defineSchema(
    "common",
    name,
    z.string().regex(idPattern(prefix)),
    `${ID_PREFIX_ENTITIES[prefix].entity} id (${prefix}<ULID>)`
  );
}

export const UserIdSchema = idSchema("usr_", "UserId");
export const PostingIdSchema = idSchema("pst_", "PostingId");
export const UserJobIdSchema = idSchema("ujb_", "UserJobId");
export const ApplicationIdSchema = idSchema("app_", "ApplicationId");
export const EventIdSchema = idSchema("evt_", "EventId");
export const InterviewIdSchema = idSchema("ivw_", "InterviewId");
export const OfferIdSchema = idSchema("ofr_", "OfferId");
export const ScoreIdSchema = idSchema("scr_", "ScoreId");
export const RuleIdSchema = idSchema("rul_", "RuleId");
export const DeviceIdSchema = idSchema("dev_", "DeviceId");
export const GrantIdSchema = idSchema("grt_", "GrantId");
export const RefreshTokenIdSchema = idSchema("rft_", "RefreshTokenId");
export const TaskIdSchema = idSchema("tsk_", "TaskId");
export const AttemptIdSchema = idSchema("att_", "AttemptId");
export const LeaseIdSchema = idSchema("lse_", "LeaseId");
export const ApprovalIdSchema = idSchema("apr_", "ApprovalId");
export const EvidenceIdSchema = idSchema("evd_", "EvidenceId");
export const FileIdSchema = idSchema("fil_", "FileId");
export const CvVariantIdSchema = idSchema("cvv_", "CvVariantId");
export const RunIdSchema = idSchema("run_", "RunId");
export const SourceIdSchema = idSchema("src_", "SourceId");
export const FactIdSchema = idSchema("fct_", "FactId");
export const AnswerIdSchema = idSchema("ans_", "AnswerId");
export const EmailIdSchema = idSchema("eml_", "EmailId");
export const SupportAccessIdSchema = idSchema("sal_", "SupportAccessId");
export const ObservationIdSchema = idSchema("obs_", "ObservationId");
export const CloudSourceIdSchema = idSchema("csr_", "CloudSourceId");
export const CloudRunIdSchema = idSchema("crn_", "CloudRunId");
/** `user_jobs.source_id`: a CLI source (`src_…`) or a cloud source (`csr_…`, 24 §5.3). */
export const UserJobSourceIdSchema = defineSchema(
  "common",
  "UserJobSourceId",
  z.string().regex(/^(?:src|csr)_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  "job source id (src_<ULID>) or cloud source id (csr_<ULID>)"
);
