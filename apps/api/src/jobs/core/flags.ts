// Feature flags and kill switches (D-33): rows of `DB.feature_flags`, never
// wrangler vars, read through a 30 s per-isolate cache.
//
// Keys and dark defaults (migration 0002 seeds them; a missing or unreadable
// row falls back to the default below):
//
//   JOBS_V1_ENABLED                 false  every /api/v1 route but /meta → 404
//   JOBS_CLI_LOGIN_ENABLED          false  first-party CLI OAuth (leaf-2.2)
//   JOBS_AUTOMATION_ENABLED         false  task claims (leaf-2.7)
//   JOBS_AUTO_MODE_ENABLED          false  `auto` rules and tasks (leaf-2.7)
//   JOBS_EMAIL_SERVER_SEND_ENABLED  false  server-sent email (leaf-2.9)
//   AI_DISABLED                     false  global AI kill switch (leaf-2.5)
//   JOBS_LEGACY_BACKEND             "kv"   /api/jobs + MCP backend (leaf-2.10)
//   JOBS_CLOUD_DISCOVERY_ENABLED    false  hourly cloud pipeline + manual runs (24)
//   JOBS_CLOUD_AI_ENABLED           false  cloud AI fallback / classification (24)
//
// `value` is a JSON scalar. Booleans also accept "1"/"0"; the backend also
// accepts the bare `kv`/`d1`.

import type { FeatureFlagKey } from "@pilihpendidikan/jobs-contracts/enums";
import { FEATURE_FLAG_KEYS } from "@pilihpendidikan/jobs-contracts/enums";
import type { Env } from "../../env";

export interface FeatureFlags {
  AI_DISABLED: boolean;
  JOBS_AUTO_MODE_ENABLED: boolean;
  JOBS_CLOUD_AI_ENABLED: boolean;
  JOBS_CLOUD_DISCOVERY_ENABLED: boolean;
  JOBS_AUTOMATION_ENABLED: boolean;
  JOBS_CLI_LOGIN_ENABLED: boolean;
  JOBS_EMAIL_SERVER_SEND_ENABLED: boolean;
  JOBS_LEGACY_BACKEND: "kv" | "d1";
  JOBS_V1_ENABLED: boolean;
}

export const FLAG_DEFAULTS: Readonly<FeatureFlags> = Object.freeze({
  JOBS_V1_ENABLED: false,
  JOBS_CLI_LOGIN_ENABLED: false,
  JOBS_AUTOMATION_ENABLED: false,
  JOBS_AUTO_MODE_ENABLED: false,
  JOBS_EMAIL_SERVER_SEND_ENABLED: false,
  AI_DISABLED: false,
  JOBS_LEGACY_BACKEND: "kv",
  JOBS_CLOUD_DISCOVERY_ENABLED: false,
  JOBS_CLOUD_AI_ENABLED: false,
});

export const FLAG_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  flags: FeatureFlags;
  loadedAt: number;
}

// Keyed by the DB binding object, so every test env (and every isolate) has
// its own cache.
const cache = new WeakMap<object, CacheEntry>();

function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === '"true"') {
    return true;
  }
  if (value === "false" || value === "0" || value === '"false"') {
    return false;
  }
  return null;
}

function parseBackend(raw: string): "kv" | "d1" | null {
  let value: unknown = raw.trim();
  try {
    value = JSON.parse(raw);
  } catch {
    // bare kv / d1
  }
  return value === "kv" || value === "d1" ? value : null;
}

/** Applies stored rows over the defaults; unknown keys and bad values are ignored. */
export function parseFlagRows(
  rows: ReadonlyArray<{ key: string; value: string }>
): FeatureFlags {
  const flags: FeatureFlags = { ...FLAG_DEFAULTS };
  for (const { key, value } of rows) {
    if (key === "JOBS_LEGACY_BACKEND") {
      flags.JOBS_LEGACY_BACKEND =
        parseBackend(value) ?? flags.JOBS_LEGACY_BACKEND;
      continue;
    }
    if (!(FEATURE_FLAG_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    const parsed = parseBoolean(value);
    if (parsed !== null) {
      (flags as unknown as Record<string, boolean>)[key] = parsed;
    }
  }
  return flags;
}

/**
 * The current flags (≤ 30 s stale per isolate, D-33). A D1 failure serves the
 * last good value, or the dark defaults when there is none.
 */
export async function getFeatureFlags(
  env: Pick<Env, "DB">,
  now: number = Date.now()
): Promise<FeatureFlags> {
  const cached = cache.get(env.DB);
  if (cached && now - cached.loadedAt < FLAG_CACHE_TTL_MS) {
    return cached.flags;
  }
  try {
    const result = await env.DB.prepare(
      "SELECT key, value FROM feature_flags"
    ).all<{ key: string; value: string }>();
    const flags = parseFlagRows(result.results ?? []);
    cache.set(env.DB, { flags, loadedAt: now });
    return flags;
  } catch (err) {
    console.error("feature_flags read failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return cached?.flags ?? { ...FLAG_DEFAULTS };
  }
}

/** True when a boolean flag is on. */
export async function isFlagEnabled(
  env: Pick<Env, "DB">,
  key: Exclude<FeatureFlagKey, "JOBS_LEGACY_BACKEND">,
  now?: number
): Promise<boolean> {
  return (await getFeatureFlags(env, now))[key];
}

/** Drops the cached flags of one DB binding (scripts and tests). */
export function clearFlagCache(env: Pick<Env, "DB">): void {
  cache.delete(env.DB);
}

/**
 * Writes one flag (the owner's admin script, `db:seed:local` and tests) and
 * drops this isolate's cache. Other isolates see it within 30 s.
 */
export async function setFeatureFlag(
  env: Pick<Env, "DB">,
  key: FeatureFlagKey,
  value: boolean | "kv" | "d1",
  updatedBy: string,
  now: number = Date.now()
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO feature_flags (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
  )
    .bind(key, JSON.stringify(value), now, updatedBy)
    .run();
  clearFlagCache(env);
}

/**
 * Feature names advertised by `GET /api/v1/meta` (`features[]`): one name per
 * enabled capability, so the CLI and the web can hide what is switched off.
 */
export function enabledFeatureNames(flags: FeatureFlags): string[] {
  const names: string[] = [];
  if (flags.JOBS_V1_ENABLED) {
    names.push("jobs_v1");
  }
  if (flags.JOBS_CLI_LOGIN_ENABLED) {
    names.push("cli_login");
  }
  if (flags.JOBS_AUTOMATION_ENABLED) {
    names.push("automation");
  }
  if (flags.JOBS_AUTO_MODE_ENABLED) {
    names.push("auto_mode");
  }
  if (flags.JOBS_EMAIL_SERVER_SEND_ENABLED) {
    names.push("email_server_send");
  }
  if (!flags.AI_DISABLED) {
    names.push("ai");
  }
  if (flags.JOBS_LEGACY_BACKEND === "d1") {
    names.push("legacy_d1");
  }
  return names;
}
