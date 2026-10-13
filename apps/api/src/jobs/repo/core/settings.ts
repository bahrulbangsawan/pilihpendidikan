// `user_settings` (04 §2.7): one row per user, created lazily with the column
// defaults on first read. Settings that are not applicant facts live here:
// locale, timezone, default application mode, the automation kill switch, AI
// consent, evidence screenshot policy and retention.
//
// Read with `getUserSettings` (any area may: the claim path checks
// `automation_paused`, AI paths check `ai_consent_at`, analytics reads
// `timezone`). Writes go through leaf-2.8's `PATCH /api/v1/settings` with
// `base_revision`; `ensureUserSettingsStatements` lets any batch create the row
// first.

import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { decodeRow, queryFirst, runBatch, stmt } from "./db";

/** The column defaults of 04 §2.7 (what a lazily created row holds). */
export const USER_SETTINGS_DEFAULTS = Object.freeze({
  locale: "en",
  timezone: "Asia/Jakarta",
  default_mode: "approval",
  automation_paused: false,
  generated_text_allowed: false,
  allow_mcp_approvals: false,
  ai_consent_at: null,
  ai_scoring_sensitive: true,
  evidence_screenshots: "on_submit",
  evidence_retention_days: 180,
} as const);

const SETTINGS_COLUMNS =
  "user_id, locale, timezone, default_mode, automation_paused, generated_text_allowed, allow_mcp_approvals, ai_consent_at, ai_scoring_sensitive, evidence_screenshots, evidence_retention_days, revision, updated_at";

/**
 * Creates the row with defaults when missing (and its change_log entry, only
 * when this batch inserted it). Safe to prepend to any batch.
 */
export function ensureUserSettingsStatements(
  db: JobsDb,
  scope: UserScope,
  now: number
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING",
      scope.userId,
      now
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'settings', user_id, revision, 'upsert', ? FROM user_settings WHERE user_id = ? AND updated_at = ? AND revision = 1 AND changes() > 0",
      now,
      scope.userId,
      now
    ),
  ];
}

/** The user's settings, creating the row with defaults on first access. */
export async function getUserSettings(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<UserSettingsRecord> {
  const existing = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT ${SETTINGS_COLUMNS} FROM user_settings WHERE user_id = ?`,
    scope.userId
  );
  if (existing) {
    return decodeRow<UserSettingsRecord>("user_settings", existing);
  }
  await runBatch(db, ensureUserSettingsStatements(db, scope, now));
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT ${SETTINGS_COLUMNS} FROM user_settings WHERE user_id = ?`,
    scope.userId
  );
  if (!created) {
    throw new Error("user_settings row missing after lazy creation");
  }
  return decodeRow<UserSettingsRecord>("user_settings", created);
}
