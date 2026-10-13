// `GET` / `PATCH /api/v1/settings` (05 §10a, 04 §2.7).
//
// The row is created lazily with the 04 §2.7 defaults (kernel
// `getUserSettings`). A patch carries `base_revision` (D-21) and writes only
// the columns that change, in ONE batch with:
//   - the `settings` change (03 §10);
//   - the fact mirrors of 03 §9: `prefs.timezone` and
//     `prefs.ai_scoring_sensitive` follow their settings columns.
// Effects after the commit (the route runs them):
//   - `automation_paused = true`: nothing to send. Running workers read the
//     flag on their next heartbeat (`cancel_requested`, 19 §8.3) and new
//     apply claims are refused (21);
//   - a timezone change sends `rebuild_analytics` (10 §5);
//   - an `ai_scoring_sensitive` change or an AI consent flip changes
//     `profile_version` → lazy re-score (07 §2.1, §8, 11 §11.5: scores made
//     without consent are deterministic-only and must be redone with AI).
// `ai_consent: true` records `ai_consent_at = now` (kept when already given);
// `false` clears it. `default_mode = auto` needs `JOBS_AUTO_MODE_ENABLED`
// (D-33; legal gate A-07) → 422 `mode_not_allowed` otherwise.

import type { UpdateSettingsRequest } from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { FeatureFlags } from "../../core/flags";
import { apiError, invalidRequest } from "../../core/http";
import { assertRevision } from "../../core/revision";
import type { UserScope } from "../../core/scope";
import type { SettingsChanges } from "../../repo/account/settings";
import { updateSettingsStatements } from "../../repo/account/settings";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import { mirrorFactStatements } from "../../repo/profile/facts";
import { AI_SENSITIVE_FACT, TIMEZONE_FACT } from "../profile/facts";
import { isValidTimeZone } from "../profile/shared";

export interface SettingsPatchPlan {
  /** False when the patch changes nothing (no write, same revision). */
  changed: boolean;
  /**
   * A profile_version input changed (`ai_scoring_sensitive`, 07 §8, or the AI
   * consent, 11 §11.5): the route schedules the profile re-score.
   */
  sensitiveChanged: boolean;
  settings: UserSettingsRecord;
  statements: D1PreparedStatement[];
  timezoneChanged: boolean;
}

const PLAIN_FIELDS = [
  "locale",
  "default_mode",
  "automation_paused",
  "generated_text_allowed",
  "allow_mcp_approvals",
  "ai_scoring_sensitive",
  "evidence_screenshots",
  "evidence_retention_days",
] as const;

function consentChange(
  body: UpdateSettingsRequest,
  current: UserSettingsRecord,
  now: number
): number | null | undefined {
  if (body.ai_consent === true && current.ai_consent_at === null) {
    return now;
  }
  if (body.ai_consent === false && current.ai_consent_at !== null) {
    return null;
  }
  return;
}

/** The columns the patch changes (only those that differ). */
export function settingsChanges(
  body: UpdateSettingsRequest,
  current: UserSettingsRecord,
  now: number
): SettingsChanges {
  const changes: Record<string, unknown> = {};
  for (const field of PLAIN_FIELDS) {
    const value = body[field];
    if (value !== undefined && value !== current[field]) {
      changes[field] = value;
    }
  }
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) {
      throw invalidRequest("timezone must be an IANA time zone.", [
        {
          code: "custom",
          path: ["timezone"],
          message: "unknown time zone",
        },
      ]);
    }
    if (body.timezone !== current.timezone) {
      changes.timezone = body.timezone;
    }
  }
  const consent = consentChange(body, current, now);
  if (consent !== undefined) {
    changes.ai_consent_at = consent;
  }
  return changes as SettingsChanges;
}

/** Plans `PATCH /api/v1/settings`. */
export async function planPatchSettings(
  db: JobsDb,
  scope: UserScope,
  input: {
    baseRevision: number;
    body: UpdateSettingsRequest;
    flags: Pick<FeatureFlags, "JOBS_AUTO_MODE_ENABLED">;
    now: number;
  }
): Promise<SettingsPatchPlan> {
  const current = await getUserSettings(db, scope, input.now);
  assertRevision(current, input.baseRevision);
  const changes = settingsChanges(input.body, current, input.now);
  if (changes.default_mode === "auto" && !input.flags.JOBS_AUTO_MODE_ENABLED) {
    throw apiError(
      "mode_not_allowed",
      "Auto mode is not available yet; choose manual, assisted or approval.",
      { details: { default_mode: "auto" } }
    );
  }
  if (Object.keys(changes).length === 0) {
    return {
      changed: false,
      sensitiveChanged: false,
      settings: current,
      statements: [],
      timezoneChanged: false,
    };
  }
  const statements = updateSettingsStatements(db, scope, {
    baseRevision: current.revision,
    changes,
    now: input.now,
  });
  if (changes.timezone !== undefined) {
    statements.push(
      ...mirrorFactStatements(db, scope, {
        id: newId("fct", input.now),
        key: TIMEZONE_FACT,
        value: changes.timezone,
        now: input.now,
      })
    );
  }
  if (changes.ai_scoring_sensitive !== undefined) {
    statements.push(
      ...mirrorFactStatements(db, scope, {
        id: newId("fct", input.now),
        key: AI_SENSITIVE_FACT,
        value: changes.ai_scoring_sensitive,
        now: input.now,
      })
    );
  }
  return {
    changed: true,
    sensitiveChanged:
      changes.ai_scoring_sensitive !== undefined ||
      changes.ai_consent_at !== undefined,
    settings: {
      ...current,
      ...changes,
      revision: current.revision + 1,
      updated_at: input.now,
    },
    statements,
    timezoneChanged: changes.timezone !== undefined,
  };
}
