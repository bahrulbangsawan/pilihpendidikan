// Shared types of the legacy jobs facade (06 §12.6): the call context, the
// backend interface both stores implement (kv.ts, d1.ts), the legacy error
// and its fixed messages. `facade.ts` picks the backend.

import type {
  ActorKind,
  ChangeSource,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { LegacyJobSection } from "@pilihpendidikan/jobs-contracts/records";
import type { Caller } from "../../auth";
import type { Env } from "../../env";
import type { JobData } from "../../types";
import type { LegacyFieldInput } from "./mapping";

/** Which surface is calling: REST owner metadata and change sources differ. */
export type LegacySurface = "rest" | "mcp";

export interface LegacyContext {
  caller: Caller;
  env: Env;
  now: number;
  surface: LegacySurface;
}

export type LegacyBackendKind = "kv" | "d1";

/** An error with the legacy status code and message (`{error}` / tool text). */
export class LegacyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LegacyError";
    this.status = status;
  }
}

/** 422 text of an illegal status transition (06 §12.6, verbatim legacy text). */
export const INVALID_STATUS = "Invalid status";
export const INVALID_INTERVIEW_DATE =
  "Interview date must be a calendar date (YYYY-MM-DD) or empty.";
export const STALE_WRITE =
  "This job was changed from another app in the last few seconds. Reload it and save again.";
export const CONCURRENT_WRITE =
  "This job changed while it was being saved. Reload it and try again.";

/** One row of `GET /api/jobs` (the legacy list shape). */
export interface LegacyListItem {
  company: string;
  id: string;
  interviewDate: string;
  status: string;
  title: string;
  updatedAt: string;
}

/** A partial update (`jobs_update`): only the given fields change. */
export interface LegacyPatch extends LegacyFieldInput {
  /** Epoch ms; null clears it (D1 backend only, 05 §14). */
  followUpAt?: number | null;
}

/** Result of a section/item edit: `sections` = the new array, or no write. */
export interface SectionEdit<T> {
  result: T;
  sections?: LegacyJobSection[];
}

export interface LegacyJobs {
  readonly kind: LegacyBackendKind;
  /** Creates a job under `job.id`; "exists" when the caller already has it. */
  create(job: JobData): Promise<JobData | "exists">;
  /** Read-modify-write of the sections; null = not found / not owned. */
  editSections<T>(
    id: string,
    edit: (sections: LegacyJobSection[]) => SectionEdit<T>
  ): Promise<T | null>;
  /** The caller's job; null = not found / not owned. */
  get(id: string): Promise<JobData | null>;
  /** Every job the caller owns, all pages (no 1,000 cap, T6-14). */
  list(): Promise<LegacyListItem[]>;
  owns(id: string): Promise<boolean>;
  /** Deletes (kv) / archives (d1, 06 §8) the job; false = not found. */
  remove(id: string): Promise<boolean>;
  /** Full-document save (`PUT /api/jobs/:id`); null = not found. */
  save(id: string, job: JobData): Promise<JobData | null>;
  /** Partial update (`jobs_update`); null = not found. */
  update(id: string, patch: LegacyPatch): Promise<JobData | null>;
}

const CHANGE_SOURCE: Readonly<Record<string, ChangeSource>> = {
  browser_session: "web",
  oauth_cli: "cli",
  oauth_mcp: "mcp",
  personal_write: "web",
  personal_read: "web",
};

/** `last_change_source` of a facade write (05 §14 stale guard compares it). */
export function changeSourceOf(ctx: LegacyContext): ChangeSource {
  if (ctx.surface === "mcp") {
    return "mcp";
  }
  const kind = ctx.caller.credentialKind;
  return kind ? (CHANGE_SOURCE[kind] ?? "web") : "web";
}

/** `actor_kind` of a facade write: MCP clients act as `mcp` (06 §4). */
export function actorOf(ctx: LegacyContext): ActorKind {
  return changeSourceOf(ctx) === "mcp" ? "mcp" : "user";
}
