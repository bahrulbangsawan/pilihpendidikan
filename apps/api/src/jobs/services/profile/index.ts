// Profile services (leaf-2.8, 05 §10): the cross-area entry points of the
// fact sheet and the answer bank. Areas that need the user's facts or
// answers (the AI proxy, the legacy facade, MCP tools) call these instead of
// reading the tables themselves.
//
//   getFactSheet     every fact + the current profile_version (07 §2.1)
//   listAnswerBank   every answer of the bank, ordered by question key
//   answerPolicy     the 19 §6.2 policy a stored answer must satisfy

import type { FactSheetResponse } from "@pilihpendidikan/jobs-contracts/api";
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { computeProfileVersion } from "../../repo/core/profile-version";
import { listAllAnswers } from "../../repo/profile/answers";
import { listFacts } from "../../repo/profile/facts";
import type { AnswerFields } from "../../repo/profile/answers";
import { enforceAnswerPolicy } from "./answers";

/** The user's fact sheet and profile version. */
export async function getFactSheet(
  env: Pick<Env, "CV_KV" | "DB">,
  db: JobsDb,
  scope: UserScope,
  options: { email?: string | null } = {}
): Promise<FactSheetResponse> {
  const facts = await listFacts(db, scope);
  const profileVersion = await computeProfileVersion(env, db, scope, options);
  return { facts, profile_version: profileVersion };
}

/** Every answer of the user's bank. */
export function listAnswerBank(
  db: JobsDb,
  scope: UserScope
): Promise<ScreeningAnswerRecord[]> {
  return listAllAnswers(db, scope);
}

/**
 * The answer as it may be stored: the protected-class lexicon raises the
 * sensitivity; `protected` + `always` throws 422 `policy_violation`.
 */
export function answerPolicy(fields: AnswerFields): AnswerFields {
  return enforceAnswerPolicy(fields);
}
