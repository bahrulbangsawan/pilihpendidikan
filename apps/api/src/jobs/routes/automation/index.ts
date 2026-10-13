// 05 §8 — automation: rules, tasks, the claim/lease protocol and approvals
// (19, 21). Owner: leaf-2.7. Scopes, idempotency and device requirements
// come from the contracts (`fromContract`); the handlers add the conditions
// the router cannot express:
//
//   POST /tasks           alt scope `automation:execute` only for an
//                         assisted/approval apply task targeted at the
//                         calling device (D-29)
//   lease routes          user + device + lease id + unexpired (21 §11); a
//                         fence failure in the write batch → 409 lease_lost
//   tasks:claim           the path device is the caller's device
//   late-evidence         only the device that held that attempt's lease

import type { TaskDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { TaskCreatedBy } from "@pilihpendidikan/jobs-contracts/enums";
import { normalizeEmail } from "../../../auth";
import { resolveOwner } from "../../../ownership";
import type { RouteContext } from "../../core/context";
import {
  apiError,
  notFound,
  replayResponse,
  revisionConflict,
} from "../../core/http";
import { parsePage } from "../../core/pagination";
import { defineRoute, fromContract } from "../../core/router";
import {
  approvalsOfTask,
  listApprovals,
  loadApproval,
} from "../../repo/automation/approvals";
import { deviceNames } from "../../repo/automation/devices";
import type { LeaseRef } from "../../repo/automation/lease";
import { FENCE_LABEL_PREFIX } from "../../repo/automation/lease";
import { listRules } from "../../repo/automation/rules";
import {
  attemptsOfTask,
  evidenceOfTask,
  findLiveApplyTask,
  findTaskByIdempotencyKey,
  listTasks,
  loadTask,
} from "../../repo/automation/tasks";
import { GuardFailedError, UniqueViolationError } from "../../repo/core/db";
import { findIdempotency } from "../../repo/core/idempotency";
import {
  decideApproval,
  getLeaseApproval,
  planCreateLeaseApproval,
} from "../../services/automation/approvals";
import { claimTask } from "../../services/automation/claim";
import { buildTaskContext } from "../../services/automation/context";
import { planSubmitIntent } from "../../services/automation/intent";
import { planLateEvidence } from "../../services/automation/late-evidence";
import {
  planHeartbeat,
  planLeaseEvents,
  requireLease,
} from "../../services/automation/lease";
import { planRelease, planResult } from "../../services/automation/result";
import {
  getRule,
  planCreateRule,
  planDeleteRule,
  planUpdateRule,
} from "../../services/automation/rules";
import { leaseLost } from "../../services/automation/shared";
import {
  duplicateTask,
  planCancelTask,
  planCreateTask,
  planResumeTask,
  planRetryTask,
} from "../../services/automation/tasks";

const TERMINAL_STATES = new Set([
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
]);

function canManage(c: RouteContext): boolean {
  return c.caller.scopes.includes("automation:manage");
}

function createdBy(c: RouteContext): TaskCreatedBy {
  return c.caller.credentialKind === "oauth_cli" ? "cli" : "web";
}

function decidedVia(c: RouteContext): "web" | "cli" | "mcp" {
  if (c.changeSource === "cli" || c.changeSource === "mcp") {
    return c.changeSource;
  }
  return "web";
}

function leaseRef(
  c: RouteContext<{ readonly lease_id: string; readonly tsk_id: string }>
): LeaseRef {
  const deviceId = c.caller.deviceId;
  if (!deviceId) {
    throw apiError("device_required", "This route needs a device-bound token.");
  }
  return { taskId: c.params.tsk_id, leaseId: c.params.lease_id, deviceId };
}

/** `c.commit` where a failed lease fence means 409 lease_lost (21 §5.3). */
async function commitLease(
  c: RouteContext,
  statements: readonly D1PreparedStatement[],
  response: { body?: unknown; status?: number }
): Promise<Response> {
  try {
    return await c.commit(statements, response);
  } catch (err) {
    if (
      err instanceof GuardFailedError &&
      err.label.startsWith(FENCE_LABEL_PREFIX)
    ) {
      throw leaseLost();
    }
    throw err;
  }
}

/**
 * A rule's `cv_policy.base_cv_id` must be the caller's own CV document (11
 * §6.1): the variant planner checks it again at run time, but a rule that
 * names someone else's CV is refused up front, like PATCH application.
 */
async function assertOwnsRuleCv(
  c: RouteContext<unknown, unknown, unknown>,
  cvId: string | null | undefined
): Promise<void> {
  if (!cvId) {
    return;
  }
  const owner = await resolveOwner(c.env, "cv", cvId);
  if (!owner || normalizeEmail(owner) !== normalizeEmail(c.caller.email)) {
    throw notFound("Base CV not found.");
  }
}

export const routes = [
  // --- rules ----------------------------------------------------------------
  defineRoute({
    ...fromContract("GET /api/v1/rules"),
    async handler(c) {
      return c.respond(await listRules(c.db, c.scope, parsePage(c.query)));
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/rules"),
    async handler(c) {
      await assertOwnsRuleCv(c, c.body.cv_policy?.base_cv_id);
      const plan = await planCreateRule(c.db, c.scope, c.body, {
        canManage: canManage(c),
        flags: c.flags,
        now: c.now,
      });
      return await c.commit(plan.statements, {
        status: 201,
        body: plan.approval
          ? { rule: plan.rule, approval: plan.approval }
          : { rule: plan.rule },
      });
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/rules/{rul_id}"),
    async handler(c) {
      return c.respond(await getRule(c.db, c.scope, c.params.rul_id));
    },
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/rules/{rul_id}"),
    async handler(c) {
      await assertOwnsRuleCv(c, c.body.cv_policy?.base_cv_id);
      const plan = await planUpdateRule(
        c.db,
        c.scope,
        c.params.rul_id,
        { ...c.body, base_revision: c.baseRevision(c.body.base_revision) },
        { canManage: canManage(c), flags: c.flags, now: c.now }
      );
      return await c.commit(plan.statements, {
        body: plan.approval
          ? { rule: plan.rule, approval: plan.approval }
          : { rule: plan.rule },
      });
    },
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/rules/{rul_id}"),
    async handler(c) {
      const plan = await planDeleteRule(c.db, c.scope, c.params.rul_id, {
        baseRevision: c.queryData.base_revision,
        now: c.now,
      });
      return await c.commit(plan.statements, {
        body: { id: c.params.rul_id, deleted: true },
      });
    },
  }),

  // --- tasks ------------------------------------------------------------------
  defineRoute({
    ...fromContract("POST /api/v1/tasks"),
    rateLimit: "task-create",
    async handler(c) {
      if (c.caller.credentialKind === "oauth_mcp") {
        throw apiError(
          "insufficient_scope",
          "MCP clients cannot create automation tasks.",
          { scope: "automation:manage" }
        );
      }
      const plan = await planCreateTask(
        c.db,
        c.scope,
        c.env,
        {
          kind: c.body.kind,
          applicationId: c.body.application_id ?? null,
          cvVariantId: c.body.cv_variant_id ?? null,
          payload: c.body.payload,
          targetDeviceId: c.body.target_device_id ?? null,
          notBefore: c.body.not_before,
          priority: c.body.priority,
          idempotencyKey: c.body.idempotency_key,
          queueWithoutDevice: c.body.queue_without_device,
          createdBy: createdBy(c),
          grantedVia: c.grantedVia === "alt_scope" ? "alt_scope" : "scope",
          callerDeviceId: c.caller.deviceId,
          source: c.changeSource,
          now: c.now,
        },
        c.flags
      );
      if (plan.existing) {
        return c.respond({ task: plan.existing }, 201);
      }
      try {
        return await c.commit(plan.statements, {
          status: 201,
          body: { task: plan.task },
        });
      } catch (err) {
        if (
          !(
            err instanceof UniqueViolationError &&
            err.table === "automation_tasks"
          )
        ) {
          throw err;
        }
        const byKey = await findTaskByIdempotencyKey(
          c.db,
          c.scope,
          c.body.idempotency_key
        );
        if (byKey) {
          return c.respond({ task: byKey }, 201);
        }
        const live = plan.task.application_id
          ? await findLiveApplyTask(c.db, c.scope, plan.task.application_id)
          : null;
        if (live) {
          throw duplicateTask(live.id);
        }
        throw err;
      }
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/tasks"),
    async handler(c) {
      const page = await listTasks(
        c.db,
        c.scope,
        {
          state: c.queryData.state,
          applicationId: c.queryData.application_id,
          kind: c.queryData.kind,
        },
        parsePage(c.query)
      );
      return c.respond(page);
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/tasks/{tsk_id}"),
    async handler(c) {
      const task = await loadTask(c.db, c.scope, c.params.tsk_id);
      if (!task) {
        throw notFound("Task not found.");
      }
      const [attempts, approvals, evidence] = await Promise.all([
        attemptsOfTask(c.db, c.scope, task.id),
        approvalsOfTask(c.db, c.scope, task.id),
        evidenceOfTask(c.db, c.scope, task.id),
      ]);
      const deviceId = task.lease_device_id ?? task.target_device_id;
      const names = deviceId
        ? await deviceNames(c.env.DB, c.scope, [deviceId])
        : new Map<string, string>();
      let context: TaskDetail["context"] = null;
      if (!TERMINAL_STATES.has(task.state) && task.kind !== "render_cv") {
        try {
          context = (await buildTaskContext(c.db, c.scope, c.env, task, {
            issueTicket: false,
            now: c.now,
          })) as TaskDetail["context"];
        } catch {
          context = null;
        }
      }
      const body: TaskDetail = {
        task,
        attempts,
        approvals,
        evidence,
        device_name: deviceId ? (names.get(deviceId) ?? null) : null,
        context,
      };
      return await c.respondWithEtag(body);
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/cancel"),
    async handler(c) {
      const plan = await planCancelTask(c.db, c.scope, c.params.tsk_id, c.now);
      if (plan.statements.length === 0) {
        return c.respond({ task: plan.task }, plan.status);
      }
      return await c.commit(plan.statements, {
        status: plan.status,
        body: { task: plan.task },
      });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/retry"),
    async handler(c) {
      const plan = await planRetryTask(
        c.db,
        c.scope,
        c.env,
        c.params.tsk_id,
        {
          confirmNotSubmitted: c.body.confirm_not_submitted === true,
          createdBy: createdBy(c),
          idempotencyKey: c.body.idempotency_key ?? c.idempotencyKey,
          now: c.now,
          source: c.changeSource,
        },
        c.flags
      );
      if (plan.existing) {
        return c.respond({ task: plan.existing }, 201);
      }
      try {
        return await c.commit(plan.statements, {
          status: 201,
          body: { task: plan.task },
        });
      } catch (err) {
        if (
          err instanceof UniqueViolationError &&
          err.table === "automation_tasks"
        ) {
          const live = plan.task.application_id
            ? await findLiveApplyTask(c.db, c.scope, plan.task.application_id)
            : null;
          if (live) {
            throw duplicateTask(live.id);
          }
        }
        throw err;
      }
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/resume"),
    async handler(c) {
      const plan = await planResumeTask(c.db, c.scope, c.params.tsk_id, c.now);
      return await c.commit(plan.statements, { body: { task: plan.task } });
    },
  }),

  // --- claim and lease --------------------------------------------------------
  defineRoute({
    ...fromContract("POST /api/v1/devices/{dev_id}/tasks:claim"),
    rateLimit: "task-poll",
    async handler(c) {
      const device = c.device;
      if (!device) {
        throw apiError(
          "device_required",
          "This route needs a device-bound token."
        );
      }
      try {
        const outcome = await claimTask(c.db, c.scope, {
          capabilities: c.body.capabilities,
          clientVersion: c.clientVersion,
          device,
          env: c.env,
          flags: c.flags,
          idempotency: (status, body) => c.idempotencyStatements(status, body),
          now: c.now,
          pathDeviceId: c.params.dev_id,
        });
        if (outcome.kind === "claimed") {
          c.markIdempotencyRecorded();
          return c.respond(outcome.body);
        }
        const replay = await storedReplay(c);
        if (replay) {
          return replay;
        }
        return c.respond(undefined, 204, {
          "Retry-After": String(Math.ceil(outcome.pollIntervalMs / 1000)),
        });
      } catch (err) {
        if (
          err instanceof UniqueViolationError &&
          err.table === "idempotency_keys"
        ) {
          const replay = await storedReplay(c);
          if (replay) {
            return replay;
          }
        }
        throw err;
      }
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat"),
    async handler(c) {
      const plan = await planHeartbeat(
        c.db,
        c.scope,
        c.env,
        leaseRef(c),
        c.body,
        c.now
      );
      return await commitLease(c, plan.statements, { body: plan.response });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/events"),
    async handler(c) {
      const plan = await planLeaseEvents(
        c.db,
        c.scope,
        leaseRef(c),
        c.body.events,
        c.now
      );
      return await commitLease(c, plan.statements, { body: plan.response });
    },
  }),
  defineRoute({
    ...fromContract(
      "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent"
    ),
    async handler(c) {
      const plan = await planSubmitIntent(c.db, c.scope, leaseRef(c), c.body, {
        flags: c.flags,
        now: c.now,
        source: c.changeSource,
      });
      return await commitLease(c, plan.statements, { body: plan.response });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/result"),
    async handler(c) {
      const plan = await planResult(c.db, c.scope, leaseRef(c), c.body, {
        now: c.now,
        source: c.changeSource,
      });
      return await commitLease(c, plan.statements, { body: plan.response });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/release"),
    async handler(c) {
      const plan = await planRelease(c.db, c.scope, leaseRef(c), c.body, c.now);
      return await commitLease(c, plan.statements, {
        body: { task: plan.task },
      });
    },
  }),
  defineRoute({
    ...fromContract(
      "POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence"
    ),
    async handler(c) {
      const deviceId = c.caller.deviceId;
      if (!deviceId) {
        throw apiError(
          "device_required",
          "This route needs a device-bound token."
        );
      }
      const plan = await planLateEvidence(c.db, c.scope, {
        taskId: c.params.tsk_id,
        attemptId: c.params.att_id,
        deviceId,
        body: c.body,
        now: c.now,
        source: c.changeSource,
      });
      return await c.commit(plan.statements, { body: plan.response });
    },
  }),

  // --- approvals ----------------------------------------------------------------
  defineRoute({
    ...fromContract("GET /api/v1/approvals"),
    async handler(c) {
      return c.respond(
        await listApprovals(
          c.db,
          c.scope,
          { state: c.queryData.state, kind: c.queryData.kind, now: c.now },
          parsePage(c.query)
        )
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/approvals/{apr_id}/decide"),
    async handler(c) {
      const result = await decideApproval(c.db, c.scope, c.env, {
        approvalId: c.params.apr_id,
        decision: c.body.decision,
        payloadHash: c.body.payload_hash,
        response: c.body.response,
        via: decidedVia(c),
        now: c.now,
      });
      try {
        return await c.commit(result.statements, {
          body: { approval: result.approval, task: result.task },
        });
      } catch (err) {
        if (
          err instanceof GuardFailedError &&
          err.label.startsWith("approval:")
        ) {
          const current = await loadApproval(c.db, c.scope, c.params.apr_id);
          throw revisionConflict(
            current,
            "Another decision was recorded first."
          );
        }
        throw err;
      }
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals"),
    async handler(c) {
      const ref = leaseRef(c);
      const lease = await requireLease(c.db, c.scope, ref, c.now);
      const plan = await planCreateLeaseApproval(c.db, c.scope, ref, {
        attempt: lease.attempt,
        body: c.body,
        now: c.now,
        task: lease.task,
      });
      return await commitLease(c, plan.statements, {
        status: 201,
        body: { approval: plan.approval },
      });
    },
  }),
  defineRoute({
    ...fromContract(
      "GET /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}"
    ),
    async handler(c) {
      const lease = await requireLease(c.db, c.scope, leaseRef(c), c.now);
      const approval = await getLeaseApproval(c.db, c.scope, {
        approvalId: c.params.apr_id,
        now: c.now,
        task: lease.task,
      });
      return c.respond({ approval });
    },
  }),
];

/** The stored response of this request's Idempotency-Key, if a racer wrote it. */
async function storedReplay(c: RouteContext): Promise<Response | null> {
  if (!c.idempotency) {
    return null;
  }
  const stored = await findIdempotency(c.db, c.scope, c.idempotency.key, c.now);
  if (!stored) {
    return null;
  }
  if (stored.request_hash !== c.idempotency.requestHash) {
    throw apiError(
      "idempotency_mismatch",
      "This Idempotency-Key was used for a different request."
    );
  }
  c.markIdempotencyRecorded();
  return replayResponse(stored.status_code, stored.response_body, c.requestId);
}
