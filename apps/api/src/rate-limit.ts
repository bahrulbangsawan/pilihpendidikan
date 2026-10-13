// KV-backed fixed-window rate limiter. Keys are `rl:{purpose}:{sha256}` so a
// KV listing never exposes an IP address or an email in plaintext.
//
// [LIMITATION] (05 §1.9) the window is a non-atomic KV read-modify-write:
// fine for abuse damping, never for exact accounting. The AI budget is
// enforced from D1 counters instead (src/jobs/repo/core/ai-usage.ts).
//
// A check may carry a `cost` (default 1): byte-weighted rules such as the
// daily upload volume count bytes instead of calls.

export interface RateLimitRule {
  purpose: string;
  max: number;
  windowMs: number;
}

export interface CheckRateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

interface CounterValue {
  count: number;
  windowStart: number;
}

// KV rejects an expirationTtl below 60 seconds.
const MIN_KV_TTL_SECONDS = 60;

async function hashKey(purpose: string, subject: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(subject)
  );
  let hex = "";
  for (const b of new Uint8Array(digest)) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `rl:${purpose}:${hex.slice(0, 32)}`;
}

export async function checkRateLimit(
  kv: KVNamespace,
  rule: RateLimitRule,
  subject: string,
  cost = 1
): Promise<CheckRateLimitResult> {
  const key = await hashKey(rule.purpose, subject);
  const now = Date.now();
  const existing = await kv.get<CounterValue>(key, "json");
  const value: CounterValue =
    existing && now - existing.windowStart < rule.windowMs
      ? existing
      : { count: 0, windowStart: now };
  if (value.count + cost > rule.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((value.windowStart + rule.windowMs - now) / 1000)
    );
    return { ok: false, retryAfterSeconds };
  }
  value.count += cost;
  await kv.put(key, JSON.stringify(value), {
    expirationTtl: Math.max(
      MIN_KV_TTL_SECONDS,
      Math.ceil(rule.windowMs / 1000)
    ),
  });
  return { ok: true, retryAfterSeconds: 0 };
}

// Checks every (rule, subject) pair in order and stops at the first one that
// is exhausted, so a blocked IP never also burns a victim's per-email budget.
// No RATE_LIMIT_KV binding means rate limiting is off (partial dev env).
export async function checkRateLimits(
  kv: KVNamespace | undefined,
  checks: ReadonlyArray<
    readonly [RateLimitRule, string] | readonly [RateLimitRule, string, number]
  >
): Promise<CheckRateLimitResult> {
  if (!kv) {
    return { ok: true, retryAfterSeconds: 0 };
  }
  for (const [rule, subject, cost] of checks) {
    const result = await checkRateLimit(kv, rule, subject, cost ?? 1);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, retryAfterSeconds: 0 };
}

// Cloudflare sets `cf-connecting-ip`; local dev falls back to the first
// X-Forwarded-For hop, then a constant bucket.
export function clientIpFor(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) {
    return cfIp;
  }
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return "unknown";
}

const MINUTE_MS = 60_000;

// Sign-in emails: an unauthenticated primitive that makes this Worker send
// mail to any address, so it is throttled per IP and per target email.
export const MAGIC_LINK_IP: RateLimitRule = {
  purpose: "magic-ip",
  max: 5,
  windowMs: 15 * MINUTE_MS,
};
export const MAGIC_LINK_EMAIL: RateLimitRule = {
  purpose: "magic-email",
  max: 3,
  windowMs: 60 * MINUTE_MS,
};
// OAuth dynamic client registration writes a D1 row per call.
export const OAUTH_REGISTER_IP: RateLimitRule = {
  purpose: "oauth-register",
  max: 10,
  windowMs: 60 * MINUTE_MS,
};
// Code / token exchanges: cheap to call, so only a brute-force ceiling.
export const EXCHANGE_IP: RateLimitRule = {
  purpose: "exchange",
  max: 30,
  windowMs: MINUTE_MS,
};
// Personal-token minting per signed-in user.
export const TOKEN_CREATE_EMAIL: RateLimitRule = {
  purpose: "token-create",
  max: 20,
  windowMs: 60 * MINUTE_MS,
};

// ---------------------------------------------------------------------------
// Job Tracker /api/v1 rules (05 §1.9). The v1 router applies them by name
// (`defineRoute({rateLimit: "sync-batch"})`, src/jobs/core/router.ts); the
// subject is the device for device rules and the user id otherwise.
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Discovery / outbox sync batches, per device.
export const SYNC_BATCH_DEVICE: RateLimitRule = {
  purpose: "sync-batch",
  max: 120,
  windowMs: MINUTE_MS,
};
// Task claim polls, per device.
export const TASK_POLL_DEVICE: RateLimitRule = {
  purpose: "task-poll",
  max: 30,
  windowMs: MINUTE_MS,
};
// AI proxy calls, per user (the daily AI budget is enforced in D1).
export const AI_INVOKE_USER: RateLimitRule = {
  purpose: "ai-invoke",
  max: 60,
  windowMs: MINUTE_MS,
};
// File uploads: 60 per hour per user …
export const FILE_UPLOAD_USER: RateLimitRule = {
  purpose: "file-upload",
  max: 60,
  windowMs: HOUR_MS,
};
// … and 500 MB per day per user (byte-weighted: cost = request bytes).
export const FILE_UPLOAD_BYTES_USER: RateLimitRule = {
  purpose: "file-upload-bytes",
  max: 500 * 1024 * 1024,
  windowMs: DAY_MS,
};
// Automation task creation, per user.
export const TASK_CREATE_USER: RateLimitRule = {
  purpose: "task-create",
  max: 200,
  windowMs: DAY_MS,
};

// Names a route may declare, with the subject each rule is keyed by.
export type V1RateLimitName =
  | "sync-batch"
  | "task-poll"
  | "ai-invoke"
  | "file-upload"
  | "task-create";

export type RateLimitSubject = "device" | "user" | "ip";

export interface V1RateLimit {
  rule: RateLimitRule;
  subject: RateLimitSubject;
  // Weighted by the request's Content-Length instead of 1.
  costFromBytes?: true;
}

export const V1_RATE_LIMITS: Readonly<
  Record<V1RateLimitName, readonly V1RateLimit[]>
> = {
  "sync-batch": [{ rule: SYNC_BATCH_DEVICE, subject: "device" }],
  "task-poll": [{ rule: TASK_POLL_DEVICE, subject: "device" }],
  "ai-invoke": [{ rule: AI_INVOKE_USER, subject: "user" }],
  "file-upload": [
    { rule: FILE_UPLOAD_USER, subject: "user" },
    { rule: FILE_UPLOAD_BYTES_USER, subject: "user", costFromBytes: true },
  ],
  "task-create": [{ rule: TASK_CREATE_USER, subject: "user" }],
};
