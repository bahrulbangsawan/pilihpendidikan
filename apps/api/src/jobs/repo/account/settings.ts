// `user_settings` writes (04 §2.7, 05 §10a). Reads and the lazy row live in
// the kernel (`repo/core/settings.ts`); this module builds the guarded
// update of `PATCH /api/v1/settings` and the facts → settings mirror.

import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { guardRevision, sqlBool, stmt } from "../core/db";
import { ensureUserSettingsStatements } from "../core/settings";

/** Columns a settings patch may write (the API names). */
export const SETTINGS_WRITABLE = [
  "locale",
  "timezone",
  "default_mode",
  "automation_paused",
  "generated_text_allowed",
  "allow_mcp_approvals",
  "ai_consent_at",
  "ai_scoring_sensitive",
  "evidence_screenshots",
  "evidence_retention_days",
] as const satisfies readonly (keyof UserSettingsRecord)[];
export type SettingsColumn = (typeof SETTINGS_WRITABLE)[number];

export type SettingsChanges = Partial<Pick<UserSettingsRecord, SettingsColumn>>;

const WRITABLE = new Set<string>(SETTINGS_WRITABLE);

function sqlValue(value: unknown): string | number | null {
  if (typeof value === "boolean") {
    return sqlBool(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
}

/**
 * Guarded UPDATE of the changed columns at `baseRevision` (D-21) + the
 * `settings` change. `changes` must be non-empty.
 */
export function updateSettingsStatements(
  db: JobsDb,
  scope: UserScope,
  input: { baseRevision: number; changes: SettingsChanges; now: number }
): D1PreparedStatement[] {
  const entries = Object.entries(input.changes).filter(([column]) =>
    WRITABLE.has(column)
  );
  if (entries.length === 0) {
    throw new Error("updateSettingsStatements needs at least one change");
  }
  const sets = entries.map(([column]) => `${column} = ?`).join(", ");
  return [
    guardRevision(db, scope, "user_settings", scope.userId, input.baseRevision),
    stmt(
      db,
      `UPDATE user_settings SET ${sets}, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?`,
      ...entries.map(([, value]) => sqlValue(value)),
      input.now,
      scope.userId,
      input.baseRevision
    ),
    appendChange(db, scope, {
      entity: "settings",
      entityId: scope.userId,
      revision: input.baseRevision + 1,
      now: input.now,
    }),
  ];
}

/**
 * Fact → settings mirror (a `prefs.timezone` / `prefs.ai_scoring_sensitive`
 * fact written through `PUT /profile/facts`): unconditional update of the
 * mirrored columns (the fact's own `base_revision` already decided the
 * write) + the `settings` change; creates the row first when missing.
 */
export function mirrorSettingsStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    changes: Pick<SettingsChanges, "ai_scoring_sensitive" | "timezone">;
    now: number;
  }
): D1PreparedStatement[] {
  const entries = Object.entries(input.changes).filter(
    ([, value]) => value !== undefined
  );
  if (entries.length === 0) {
    return [];
  }
  const sets = entries.map(([column]) => `${column} = ?`).join(", ");
  return [
    ...ensureUserSettingsStatements(db, scope, input.now),
    stmt(
      db,
      `UPDATE user_settings SET ${sets}, revision = revision + 1, updated_at = ? WHERE user_id = ?`,
      ...entries.map(([, value]) => sqlValue(value)),
      input.now,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "settings",
      table: "user_settings",
      id: scope.userId,
      now: input.now,
    }),
  ];
}
