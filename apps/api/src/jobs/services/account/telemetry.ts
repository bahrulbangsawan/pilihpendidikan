// Anonymous CLI telemetry and crash reports (05 §10a, 22 §8).
//
// Both routes are public (no credential is read, so no user or device id
// can reach them) and rate-limited per IP hash (the limiter keys KV by a
// SHA-256 of the IP; the IP itself is never stored). Nothing here logs or
// stores an IP, an email, a token or a user/device id.
//
// Telemetry: one `telemetry_daily` row per (day, random install hash). The
// CLI sends a day's counters (its local totals for that day); a resend of the
// same day merges by taking each counter's maximum, so a retried or repeated
// upload never double-counts. Only the known counter groups are kept, and
// only keys that look like command names, adapter:error classes, exit codes
// or duration buckets — anything else (a stray URL, an email) is dropped.
//
// Crash reports: the redacted traceback (frame file + line only) as JSON in
// R2 under `telemetry/crash/<day>/<random>.json`, kept 30 days (the daily
// retention cron). The server redacts again (emails, URLs, secrets, paths).

import type {
  CrashReportRequest,
  TelemetryRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { DAY_MS, utcDay } from "../../core/clock";
import { invalidRequest } from "../../core/http";
import type { JobsDb } from "../../repo/core/db";
import {
  loadTelemetryDay,
  upsertTelemetryDay,
} from "../../repo/account/telemetry";

/** Days of telemetry the server accepts (and keeps, 04 §4). */
export const TELEMETRY_RETENTION_DAYS = 90;
/** Crash reports are kept 30 days (22 §8.2). */
export const CRASH_RETENTION_DAYS = 30;
export const CRASH_PREFIX = "telemetry/crash/";

const COUNTER_GROUPS = [
  "commands",
  "error_classes",
  "exit_codes",
  "duration_buckets",
  "outcomes",
] as const;
const MAX_KEYS_PER_GROUP = 200;
const MAX_COUNT = 1_000_000;
const COUNTER_KEY_RE = /^[A-Za-z0-9 _.:<>+/-]{1,80}$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9._+-]{1,40}$/;
const INSTALL_HASH_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL_RE = /[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const SECRET_RE = /[A-Za-z0-9+/_=-]{41,}/g;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:\//;
const ABSOLUTE_PATH_RE =
  /(?<![\w.-])(?:[A-Za-z]:\\|\/)(?:[^\s"'/\\]+[/\\])+[^\s"'/\\]*/g;

type Counters = Record<string, unknown>;

function cleanGroup(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, number> = {};
  let kept = 0;
  for (const [key, count] of Object.entries(value)) {
    if (kept >= MAX_KEYS_PER_GROUP) {
      break;
    }
    if (
      COUNTER_KEY_RE.test(key) &&
      typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 0
    ) {
      out[key] = Math.min(count, MAX_COUNT);
      kept += 1;
    }
  }
  return out;
}

/** Only the known counter groups, with well-formed keys and counts. */
export function sanitizeCounters(counters: Counters): Counters {
  const out: Counters = { commands: {}, error_classes: {} };
  for (const group of COUNTER_GROUPS) {
    const cleaned = cleanGroup(counters[group]);
    if (cleaned) {
      out[group] = cleaned;
    }
  }
  const steps = counters.agent_steps;
  if (typeof steps === "number" && Number.isInteger(steps) && steps >= 0) {
    out.agent_steps = Math.min(steps, MAX_COUNT);
  }
  return out;
}

/** Counter-wise maximum of two sanitized counter sets. */
export function mergeCounters(stored: Counters, incoming: Counters): Counters {
  const out: Counters = { ...stored };
  for (const group of COUNTER_GROUPS) {
    const a = (stored[group] ?? {}) as Record<string, number>;
    const b = incoming[group] as Record<string, number> | undefined;
    if (!b) {
      continue;
    }
    const merged: Record<string, number> = { ...a };
    for (const [key, count] of Object.entries(b)) {
      if (key in merged || Object.keys(merged).length < MAX_KEYS_PER_GROUP) {
        merged[key] = Math.max(merged[key] ?? 0, count);
      }
    }
    out[group] = merged;
  }
  if (typeof incoming.agent_steps === "number") {
    out.agent_steps = Math.max(
      typeof stored.agent_steps === "number" ? stored.agent_steps : 0,
      incoming.agent_steps
    );
  }
  return out;
}

function checkToken(field: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw invalidRequest(`${field} is not well-formed.`, [
      { code: "custom", path: [field], message: "unexpected characters" },
    ]);
  }
}

/** Records one install-day of counters (22 §8.1). */
export async function acceptTelemetry(
  db: JobsDb,
  body: TelemetryRequest,
  now: number
): Promise<void> {
  checkToken("install_hash", body.install_hash, INSTALL_HASH_RE);
  checkToken("cli_version", body.cli_version, SAFE_TOKEN_RE);
  checkToken("platform", body.platform, SAFE_TOKEN_RE);
  const oldest = utcDay(now - TELEMETRY_RETENTION_DAYS * DAY_MS);
  const newest = utcDay(now + DAY_MS);
  if (body.day < oldest || body.day > newest) {
    throw invalidRequest(`day must be between ${oldest} and ${newest} (UTC).`, [
      { code: "custom", path: ["day"], message: "outside the accepted window" },
    ]);
  }
  const counters = sanitizeCounters(body.counters as Counters);
  const stored = await loadTelemetryDay(db, body.day, body.install_hash);
  await upsertTelemetryDay(db, {
    day: body.day,
    install_hash: body.install_hash,
    cli_version: body.cli_version,
    platform: body.platform,
    counters: stored ? mergeCounters(stored.counters, counters) : counters,
  });
}

/** Second-line redaction of crash text (the CLI redacts first, 16 §10). */
export function redactCrashText(text: string): string {
  return text
    .replace(EMAIL_RE, "<email>")
    .replace(URL_RE, "<url>")
    .replace(ABSOLUTE_PATH_RE, "<path>")
    .replace(SECRET_RE, "<redacted>");
}

/** Package-relative frame file: never an absolute path. */
function frameFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const relative =
    normalized.startsWith("/") || WINDOWS_DRIVE_RE.test(normalized)
      ? (normalized.split("/").at(-1) ?? "")
      : normalized;
  return redactCrashText(relative).slice(0, 300);
}

/** Stores one crash report; returns its R2 key. */
export async function storeCrashReport(
  bucket: R2Bucket,
  body: CrashReportRequest,
  now: number
): Promise<string> {
  checkToken("install_hash", body.install_hash, INSTALL_HASH_RE);
  checkToken("cli_version", body.cli_version, SAFE_TOKEN_RE);
  checkToken("platform", body.platform, SAFE_TOKEN_RE);
  const report = {
    received_at: now,
    install_hash: body.install_hash,
    cli_version: body.cli_version,
    platform: body.platform,
    python_version: body.python_version ?? null,
    occurred_at: body.occurred_at,
    exception_type: redactCrashText(body.exception_type).slice(0, 200),
    message: redactCrashText(body.message).slice(0, 500),
    frames: body.frames.map((frame) => ({
      file: frameFile(frame.file),
      line: frame.line,
      function: frame.function
        ? redactCrashText(frame.function).slice(0, 200)
        : null,
    })),
  };
  const key = `${CRASH_PREFIX}${utcDay(now)}/${crypto.randomUUID()}.json`;
  await bucket.put(key, JSON.stringify(report), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return key;
}
