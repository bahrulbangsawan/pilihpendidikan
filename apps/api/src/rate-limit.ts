// KV-backed fixed-window rate limiter. Keys are `rl:{purpose}:{sha256}` so a
// KV listing never exposes an IP address or an email in plaintext.

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
  subject: string
): Promise<CheckRateLimitResult> {
  const key = await hashKey(rule.purpose, subject);
  const now = Date.now();
  const existing = await kv.get<CounterValue>(key, "json");
  const value: CounterValue =
    existing && now - existing.windowStart < rule.windowMs
      ? existing
      : { count: 0, windowStart: now };
  if (value.count >= rule.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((value.windowStart + rule.windowMs - now) / 1000)
    );
    return { ok: false, retryAfterSeconds };
  }
  value.count += 1;
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
  checks: ReadonlyArray<readonly [RateLimitRule, string]>
): Promise<CheckRateLimitResult> {
  if (!kv) {
    return { ok: true, retryAfterSeconds: 0 };
  }
  for (const [rule, subject] of checks) {
    const result = await checkRateLimit(kv, rule, subject);
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
