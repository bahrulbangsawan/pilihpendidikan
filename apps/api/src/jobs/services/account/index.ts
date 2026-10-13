// Account services (leaf-2.8, 05 §10a, 11 §10, 22 §8): the cross-area entry
// points of settings and account lifecycle.
//
//   readSettings        the user's settings (lazy row, 04 §2.7)
//   isAccountClosing    true once the account is tombstoned (11 §10): work
//                       for that user (queue, cron) should stop

import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import { findUserById } from "../../repo/core/users";

/** The user's settings. */
export function readSettings(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<UserSettingsRecord> {
  return getUserSettings(db, scope, now);
}

/** True when the account is tombstoned (deletion running or done). */
export async function isAccountClosing(
  env: Pick<Env, "DB">,
  scope: UserScope
): Promise<boolean> {
  const user = await findUserById(env.DB, scope.userId);
  return user === null || user.deleted_at !== null;
}
