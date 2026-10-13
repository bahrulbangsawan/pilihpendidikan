import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  APPROVAL_KINDS,
  APPROVAL_STATES,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ApprovalKind } from "@pilihpendidikan/jobs-contracts/enums";
import { ApprovalResponseSchema } from "@pilihpendidikan/jobs-contracts/records";
import type { ApprovalRecord } from "@pilihpendidikan/jobs-contracts/records";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { json, text } from "../helpers";
import { facadeScope } from "../jobs/legacy/d1";
import type { ToolText } from "../jobs/legacy/mcp";
import {
  isoOrNull,
  jobTrackerOff,
  mcpContext,
  withJobErrors,
} from "../jobs/legacy/mcp";
import { parsePage } from "../jobs/core/pagination";
import { listApprovals, loadApproval } from "../jobs/repo/automation/approvals";
import { GuardFailedError } from "../jobs/repo/core/db";
import { getUserSettings } from "../jobs/repo/core/settings";
import { commitLegacyBatch } from "../jobs/repo/legacy/write";
import { decideApproval } from "../jobs/services/automation";

// `jobs_approvals_list` / `jobs_approval_decide` (05 §14, 11 §4.9, 06 §11).
// An MCP client is an AI agent acting on untrusted content, so it may decide
// only `answer` and `cv_variant` approvals, only when the user turned on
// `user_settings.allow_mcp_approvals` (default off), and never `submit` or
// `rule_activation` approvals. This is the one MCP exception to the
// `automation:manage` requirement of `/approvals/{id}/decide`, checked here
// rather than by scope. Everything else is sent to the web approval queue.

const NOT_SIGNED_IN = text("Not signed in.");

/** Kinds an MCP client may decide (05 §14). */
export const MCP_DECIDABLE_KINDS: ReadonlySet<ApprovalKind> = new Set([
  "answer",
  "cv_variant",
]);

const DEFAULT_APP_ORIGIN = "https://jobs.pilihpendidikan.com";
const TRAILING_SLASHES_RE = /\/+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** The web approval queue (12 §6.1: `/automation`, default tab). */
export function approvalQueueUrl(env: Env): string {
  const origin = (env.JOBS_APP_ORIGIN ?? DEFAULT_APP_ORIGIN).replace(
    TRAILING_SLASHES_RE,
    ""
  );
  return `${origin}/automation`;
}

function compactApproval(approval: ApprovalRecord, mayDecide: boolean) {
  return {
    id: approval.id,
    kind: approval.kind,
    state: approval.state,
    application_id: approval.application_id,
    task_id: approval.task_id,
    payload: approval.payload,
    payload_hash: approval.payload_hash,
    expires_at: isoOrNull(approval.expires_at),
    created_at: isoOrNull(approval.created_at),
    decided_via: approval.decided_via,
    decidable_via_mcp: mayDecide,
  };
}

interface DecideArgs {
  approval_id: string;
  decision: "approve" | "reject";
  payload_hash: string;
  response?: z.infer<typeof ApprovalResponseSchema>;
}

/** Why MCP may not decide this approval (null = it may). */
function mcpRefusal(
  env: Env,
  kind: ApprovalKind,
  allowed: boolean
): ToolText | null {
  const queue = approvalQueueUrl(env);
  if (!MCP_DECIDABLE_KINDS.has(kind)) {
    const what = kind === "submit" ? "Submissions" : "Rule activations";
    return text(
      `${what} can only be decided by you in the approval queue: ${queue}`
    );
  }
  if (!allowed) {
    return text(
      `AI assistants may not decide approvals for this account (Settings → "Allow AI assistants (MCP) to answer questions and approve CV variants"). Decide it in the approval queue: ${queue}`
    );
  }
  return null;
}

async function decideFromMcp(
  env: Env,
  caller: Caller,
  args: DecideArgs
): Promise<ToolText> {
  const ctx = mcpContext(env, caller);
  const off = await jobTrackerOff(env, ctx.now);
  if (off) {
    return off;
  }
  const { db, scope } = await facadeScope(ctx);
  const approval = await loadApproval(db, scope, args.approval_id);
  if (!approval) {
    return text(`Approval "${args.approval_id}" not found.`);
  }
  const settings = MCP_DECIDABLE_KINDS.has(approval.kind)
    ? await getUserSettings(db, scope, ctx.now)
    : null;
  const refusal = mcpRefusal(
    env,
    approval.kind,
    settings?.allow_mcp_approvals === true
  );
  if (refusal) {
    return refusal;
  }
  const result = await decideApproval(db, scope, env, {
    approvalId: approval.id,
    decision: args.decision,
    payloadHash: args.payload_hash,
    response: args.response,
    via: "mcp",
    now: ctx.now,
  });
  try {
    await commitLegacyBatch(db, result.statements);
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return text("Another decision was recorded first.");
    }
    throw err;
  }
  return json({
    approval: compactApproval(result.approval, false),
    task: result.task ? { id: result.task.id, state: result.task.state } : null,
  });
}

export function registerJobsApprovalsTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "jobs_approvals_list",
    {
      description:
        "List your Job Tracker approvals (pending by default): submissions, screening answers, CV variants and rule activations waiting for a decision. decidable_via_mcp says whether jobs_approval_decide may decide one.",
      inputSchema: {
        state: z
          .enum(APPROVAL_STATES)
          .optional()
          .describe("Filter by state (default: pending)"),
        kind: z.enum(APPROVAL_KINDS).optional().describe("Filter by kind"),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z
          .string()
          .optional()
          .describe("next_cursor of the previous page"),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const ctx = mcpContext(env, caller);
        const off = await jobTrackerOff(env, ctx.now);
        if (off) {
          return off;
        }
        const { db, scope } = await facadeScope(ctx);
        const [settings, page] = await Promise.all([
          getUserSettings(db, scope, ctx.now),
          listApprovals(
            db,
            scope,
            { state: args.state ?? "pending", kind: args.kind, now: ctx.now },
            parsePage({ limit: args.limit, cursor: args.cursor })
          ),
        ]);
        return json({
          allow_mcp_approvals: settings.allow_mcp_approvals,
          approval_queue: approvalQueueUrl(env),
          items: page.items.map((approval) =>
            compactApproval(
              approval,
              settings.allow_mcp_approvals &&
                approval.state === "pending" &&
                MCP_DECIDABLE_KINDS.has(approval.kind)
            )
          ),
          next_cursor: page.next_cursor,
        });
      })
  );

  server.registerTool(
    "jobs_approval_decide",
    {
      description:
        "Approve or reject a pending answer or CV-variant approval. Works only when you allowed AI assistants to decide approvals in the Job Tracker settings; submissions and rule activations are always decided by you in the web approval queue. Pass the payload_hash shown by jobs_approvals_list.",
      inputSchema: {
        approval_id: z.string().min(1).describe("Approval id (apr_…)"),
        decision: z.enum(["approve", "reject"]),
        payload_hash: z
          .string()
          .regex(SHA256_HEX_RE)
          .describe("payload_hash of the approval as listed"),
        response: ApprovalResponseSchema.optional().describe(
          "For answer approvals: {answers: [{ref, value, save_to_bank?}]}; optional note"
        ),
      },
    },
    (args) =>
      withJobErrors(() =>
        caller
          ? decideFromMcp(env, caller, args)
          : Promise.resolve(NOT_SIGNED_IN)
      )
  );
}
