// The claim context bundle (21 §5.1, 19 §2, contracts `TaskContext`):
//
//   apply      application, posting, mode, the attached CV variant's PDF
//              (file id + sha256, verified by the CLI), the rule and its
//              limits, allowed domains (posting apply domain + adapter ATS
//              hosts + rule domains), the adapter's automation flags, the
//              approval policy, and the approved approval when resuming
//   discover   the sources to run
//   render_cv  the variant id and a single-use render ticket (PLAN C8,
//              minted through leaf-2.6's ticket service)

import type { TaskContext } from "@pilihpendidikan/jobs-contracts/api";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { loadApproval } from "../../repo/automation/approvals";
import {
  postingOfUserJob,
  sourcesFor,
  variantApplication,
  variantFile,
} from "../../repo/automation/context";
import { loadRule } from "../../repo/automation/rules";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import { issueRenderTicket } from "../cv/index";
import { adapterOf, allowedDomainsFor } from "./policy";

export interface ContextOptions {
  /** Mint a render ticket for render_cv (claims only; never on reads). */
  issueTicket: boolean;
  now: number;
}

async function applyContext(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord,
  now: number
): Promise<TaskContext> {
  if (!task.application_id) {
    throw notFound("The task's application is gone.");
  }
  const application = await loadApplication(db, scope, task.application_id);
  if (!application) {
    throw notFound("The task's application is gone.");
  }
  const posting = await postingOfUserJob(db, scope, application.user_job_id);
  if (!posting) {
    throw notFound("The task's posting is gone.");
  }
  const mode = task.payload.mode ?? "approval";
  const rule = task.payload.rule_id
    ? await loadRule(db, scope, task.payload.rule_id)
    : null;
  const variant = application.cv_variant_id
    ? await variantFile(db, scope, application.cv_variant_id)
    : null;
  const settings = await getUserSettings(db, scope, now);
  const adapter = adapterOf(posting);
  let resume: { approval_id: string; payload_hash: string } | null = null;
  if (task.payload.resume_from_approval) {
    const approval = await loadApproval(
      db,
      scope,
      task.payload.resume_from_approval
    );
    if (approval?.state === "approved" && approval.task_id === task.id) {
      resume = {
        approval_id: approval.id,
        payload_hash: approval.payload_hash,
      };
    }
  }
  const fileReady =
    variant?.file_id &&
    variant.sha256 &&
    (variant.file_status === null || variant.file_status === "ready");
  return {
    kind: "apply",
    application,
    posting,
    mode,
    cv:
      variant && fileReady
        ? {
            cv_variant_id: variant.cv_variant_id,
            status: variant.status as "approved",
            file: {
              file_id: variant.file_id as string,
              sha256: variant.sha256 as string,
            },
          }
        : null,
    cover_letter: null,
    rule: rule
      ? {
          id: rule.id,
          mode: rule.mode,
          limits: rule.limits,
          cv_policy: rule.cv_policy,
        }
      : null,
    allowed_domains: allowedDomainsFor(posting, rule?.allowed_domains ?? []),
    adapter: adapter
      ? {
          id: adapter.id,
          headless_ok: adapter.automation.headless_ok,
          auto_ok: adapter.automation.auto_ok,
          confirmation_url_patterns:
            adapter.automation.confirmation_url_patterns,
          confirmation_selectors: adapter.automation.confirmation_selectors,
        }
      : null,
    approval_policy: {
      submit_requires_approval: mode === "approval",
      generated_text_allowed: settings.generated_text_allowed,
      evidence_screenshots: settings.evidence_screenshots,
    },
    resume_from_approval: resume,
  };
}

/**
 * The context of a task; null for a render_cv task when no ticket may be
 * issued (task detail reads). Throws 404 when a referenced record is gone.
 */
export async function buildTaskContext(
  db: JobsDb,
  scope: UserScope,
  env: Pick<Env, "AUTH_KV" | "JOBS_APP_ORIGIN">,
  task: AutomationTaskRecord,
  options: ContextOptions
): Promise<TaskContext | null> {
  if (task.kind === "apply") {
    return await applyContext(db, scope, task, options.now);
  }
  if (task.kind === "discover") {
    const ids = task.payload.source_ids ?? null;
    return { kind: "discover", sources: await sourcesFor(db, scope, ids) };
  }
  if (!task.cv_variant_id) {
    throw notFound("The task's CV variant is gone.");
  }
  const variant = await variantApplication(db, scope, task.cv_variant_id);
  if (!variant) {
    throw notFound("The task's CV variant is gone.");
  }
  if (!options.issueTicket) {
    return null;
  }
  const render = await issueRenderTicket(env, {
    userId: scope.userId,
    cvvId: variant.id,
    now: options.now,
  });
  return { kind: "render_cv", cv_variant_id: variant.id, render };
}
