// The CV side of a rule with `cv_policy.tailor` (21 §4 "saved with
// cv_policy.tailor, which first creates a CV variant", 08 §4.1): plans a
// tailored variant through leaf-2.6's `planCreateCvVariant` (it moves the
// card saved → preparing and supersedes in-flight variants). The caller
// commits the statements together with the task, then calls `afterCommit`
// (it sends the `tailor_cv` message).

import type { CvTemplate } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  AutomationRuleRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import { isApiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { primaryCvId } from "../../repo/automation/context";
import type { JobsDb } from "../../repo/core/db";
import { planCreateCvVariant } from "../cv/index";

/** The template of rule-requested variants (the CV builder's default). */
export const RULE_CV_TEMPLATE: CvTemplate = "standard";

export type CvRequest =
  | {
      afterCommit: () => Promise<void>;
      cvVariantId: string;
      ok: true;
      statements: D1PreparedStatement[];
    }
  | { ok: false; reason: string };

/** Plans the tailored variant a rule asks for (no I/O beyond reads). */
export async function planRuleCvVariant(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: { app: ApplicationRecord; now: number; rule: AutomationRuleRecord }
): Promise<CvRequest> {
  const baseCvId =
    input.rule.cv_policy.base_cv_id ??
    input.app.base_cv_id ??
    (await primaryCvId(db, scope));
  if (!baseCvId) {
    return { ok: false, reason: "no_base_cv" };
  }
  try {
    const plan = await planCreateCvVariant(db, scope, env, {
      actorKind: "system",
      applicationId: input.app.id,
      baseCvId,
      now: input.now,
      source: "system",
      tailor: true,
      template: RULE_CV_TEMPLATE,
    });
    return {
      ok: true,
      cvVariantId: plan.cvVariantId,
      statements: plan.statements,
      afterCommit: plan.afterCommit,
    };
  } catch (err) {
    if (isApiError(err) && err.status < 500) {
      return { ok: false, reason: `cv_${err.code}` };
    }
    throw err;
  }
}
