// Glue between the MCP jobs tools (src/tools/jobs*.ts) and the facade / board
// services: the call context, error texts, the ownership check the MCP
// ownership guard runs for `jobs` tools, and the application lookup of the
// new board tools (05 §14, 06 §11).

import type { Caller } from "../../auth";
import type { Env } from "../../env";
import { text } from "../../helpers";
import type { ApiError } from "../core/http";
import { isApiError } from "../core/http";
import { getFeatureFlags } from "../core/flags";
import { GuardFailedError, UniqueViolationError } from "../repo/core/db";
import { resolveApplication } from "./d1";
import { legacyBackendKind, legacyJobs } from "./facade";
import type { LegacyJobSection } from "@pilihpendidikan/jobs-contracts/records";
import type { LegacyContext, SectionEdit } from "./types";
import { LegacyError } from "./types";

export type ToolText = ReturnType<typeof text>;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The facade context of one MCP tool call. */
export function mcpContext(env: Env, caller: Caller): LegacyContext {
  return { caller, env, now: Date.now(), surface: "mcp" };
}

/**
 * The new board tools act on JOBS_DB applications in both backend modes
 * (addressed by `app_` id or legacy id); the rest of `jobs_*` go through the
 * flag-selected facade.
 */
export const BOARD_TOOLS: ReadonlySet<string> = new Set([
  "jobs_move",
  "jobs_note_add",
  "jobs_interview_add",
  "jobs_offer_add",
]);

/**
 * Whether the caller may use `id` with `tool` (the MCP ownership guard).
 * Not owned and missing are the same `false` (11 §6.1); no admin bypass
 * (D-26).
 */
export async function canAccessJob(
  ctx: LegacyContext,
  tool: string,
  id: string
): Promise<boolean> {
  if (BOARD_TOOLS.has(tool)) {
    const kind = await legacyBackendKind(ctx.env, ctx.now);
    const { view } = await resolveApplication(ctx, id, {
      kvFallback: kind === "d1",
    });
    return view !== null;
  }
  return await (await legacyJobs(ctx)).owns(id);
}

/** A kernel error as one line for an MCP client. */
export function apiErrorText(err: ApiError): string {
  if (err.code === "revision_conflict") {
    const current = (err.details?.current ?? null) as {
      revision?: number;
    } | null;
    return current?.revision === undefined
      ? `${err.message}`
      : `${err.message} (current revision ${current.revision})`;
  }
  return err.message;
}

/** Runs a tool body; facade and kernel refusals become tool text. */
export async function withJobErrors(
  fn: () => Promise<ToolText>
): Promise<ToolText> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LegacyError) {
      return text(err.message);
    }
    if (isApiError(err)) {
      return text(apiErrorText(err));
    }
    if (
      err instanceof GuardFailedError ||
      err instanceof UniqueViolationError
    ) {
      return text("The job changed while this ran. Read it again and retry.");
    }
    throw err;
  }
}

/** Null when the Job Tracker is on (JOBS_V1_ENABLED), else the refusal. */
export async function jobTrackerOff(
  env: Env,
  now: number
): Promise<ToolText | null> {
  const flags = await getFeatureFlags(env, now);
  return flags.JOBS_V1_ENABLED
    ? null
    : text("The Job Tracker is not available yet.");
}

/** Epoch ms of an ISO date ("YYYY-MM-DD" = 09:00 UTC) or date-time. */
export function parseWhen(value: string): number | null {
  const dateOnly = DATE_ONLY_RE.test(value);
  const ms = Date.parse(dateOnly ? `${value}T09:00:00Z` : value);
  return Number.isFinite(ms) ? ms : null;
}

/** ISO string or null (tool output). */
export function isoOrNull(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

/**
 * One read-modify-write of a job's `sections` through the facade (the KV
 * blob, or `applications.sections` on JOBS_DB under its revision): the
 * `jobs_section_*` / `jobs_item_*` tools.
 */
export async function editJobSections(
  env: Env,
  caller: Caller | null,
  jobId: string,
  edit: (sections: LegacyJobSection[]) => SectionEdit<ToolText>
): Promise<ToolText> {
  if (!caller) {
    return text("Not signed in.");
  }
  return await withJobErrors(async () => {
    const jobs = await legacyJobs(mcpContext(env, caller));
    const result = await jobs.editSections(jobId, edit);
    return result ?? text(`Job "${jobId}" not found.`);
  });
}
