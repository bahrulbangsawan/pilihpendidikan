import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { json, text } from "../helpers";
import { legacyJobs } from "../jobs/legacy/facade";
import { LOSSY_STATUS_NOTE } from "../jobs/legacy/mapping";
import { mcpContext, parseWhen, withJobErrors } from "../jobs/legacy/mcp";
import type { LegacyPatch } from "../jobs/legacy/types";
import type { JobData } from "../types";
import { createEmptyJob, JOB_STATUSES } from "../types";

// Shared by jobs_create + jobs_update: a company URL must be a valid URL or the
// empty string (to leave unset / clear), and the param itself is optional. zod
// validates the URL server-side so a malformed value is rejected before write.
const COMPANY_URL_SCHEMA = z.union([z.literal(""), z.url()]).optional();

interface JobFieldArgs {
  company?: string;
  company_url?: string;
  interview_date?: string;
  job_description?: string[];
  requirements?: string[];
  salary_range?: string;
}

// Structured fields shared by jobs_create + jobs_update (snake_case tool params
// → camelCase JobData keys). Each is applied only when the caller supplied it,
// so an update leaves omitted fields untouched.
function jobFields(args: JobFieldArgs): Partial<JobData> {
  const fields: Partial<JobData> = {};
  if (args.company !== undefined) {
    fields.company = args.company;
  }
  if (args.company_url !== undefined) {
    fields.companyUrl = args.company_url;
  }
  if (args.salary_range !== undefined) {
    fields.salaryRange = args.salary_range;
  }
  if (args.job_description !== undefined) {
    fields.jobDescription = args.job_description;
  }
  if (args.requirements !== undefined) {
    fields.requirements = args.requirements;
  }
  if (args.interview_date !== undefined) {
    fields.interviewDate = args.interview_date;
  }
  return fields;
}

interface UpdateArgs extends JobFieldArgs {
  follow_up_at?: string | null;
  status?: JobData["status"];
  title?: string;
}

/** The facade patch of a jobs_update call, or the refusal text. */
function updatePatch(args: UpdateArgs): LegacyPatch | ReturnType<typeof text> {
  const patch: LegacyPatch = { ...jobFields(args) };
  if (args.title !== undefined) {
    patch.title = args.title;
  }
  if (args.status !== undefined) {
    patch.status = args.status;
  }
  if (args.follow_up_at === undefined) {
    return patch;
  }
  const raw = args.follow_up_at;
  const when = raw === null || raw === "" ? null : parseWhen(raw);
  if (raw && when === null) {
    return text(
      "follow_up_at must be an ISO date (YYYY-MM-DD) or date-time, or empty to clear it."
    );
  }
  patch.followUpAt = when;
  return patch;
}

const NOT_SIGNED_IN = text("Not signed in.");

function notFound(jobId: string) {
  return text(`Job "${jobId}" not found.`);
}

// Top-level CRUD for the per-user jobs tracker, served by the legacy facade
// (src/jobs/legacy: KV or JOBS_DB by the JOBS_LEGACY_BACKEND flag).
// jobs_list/jobs_create self-scope (list returns the caller's jobs, create
// writes under the caller), so the ownership guard (ownership-guard.ts) lets
// them through; every other tool here is gated by the guard on `job_id`.
export function registerJobsManagementTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "jobs_list",
    {
      description: `List the job applications you are tracking, with their IDs, titles, statuses and interview dates (every job, no page limit). ${LOSSY_STATUS_NOTE}`,
      inputSchema: {},
    },
    async () => {
      if (!caller) {
        return NOT_SIGNED_IN;
      }
      const jobs = await legacyJobs(mcpContext(env, caller));
      const rows = await jobs.list();
      if (rows.length === 0) {
        return text("No jobs found. Use jobs_create to start tracking one.");
      }
      return json(
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          interviewDate: row.interviewDate,
        }))
      );
    }
  );

  server.registerTool(
    "jobs_get",
    {
      description: `Get the full data of a tracked job by its ID, including its sections and items. ${LOSSY_STATUS_NOTE} interviewDate is the date of the next pending interview.`,
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
      },
    },
    async ({ job_id }) => {
      if (!caller) {
        return NOT_SIGNED_IN;
      }
      const jobs = await legacyJobs(mcpContext(env, caller));
      const data = await jobs.get(job_id);
      return data ? json(data) : notFound(job_id);
    }
  );

  server.registerTool(
    "jobs_create",
    {
      description:
        "Create a new job-application tracker entry. Re-creating one of your existing IDs is rejected — it never overwrites a job.",
      inputSchema: {
        job_id: z
          .string()
          .min(1)
          .describe(
            "Job identifier (a UUID, or a slug like 'acme-senior-eng')"
          ),
        title: z
          .string()
          .min(1)
          .describe("Job title, e.g. 'Senior Engineer @ Acme'"),
        status: z
          .enum(JOB_STATUSES)
          .optional()
          .describe(
            "Pipeline status: saved, applied, interviewing, offer, rejected, or accepted (default: saved)"
          ),
        company: z.string().optional().describe("Hiring company name"),
        company_url: COMPANY_URL_SCHEMA.describe(
          "Company website URL (must be a valid URL, or empty to leave unset)"
        ),
        salary_range: z
          .string()
          .optional()
          .describe("Compensation band, e.g. '$120k–$150k'"),
        job_description: z
          .array(z.string())
          .optional()
          .describe("Posted job-description lines"),
        requirements: z
          .array(z.string())
          .optional()
          .describe("Role requirement lines"),
        interview_date: z
          .string()
          .optional()
          .describe(
            "Scheduled interview date as an ISO calendar date (YYYY-MM-DD)"
          ),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const job: JobData = {
          ...createEmptyJob(),
          ...jobFields(args),
          id: args.job_id,
          title: args.title,
        };
        if (args.status) {
          job.status = args.status;
        }
        const jobs = await legacyJobs(mcpContext(env, caller));
        const created = await jobs.create(job);
        if (created === "exists") {
          return text(
            `Job "${args.job_id}" already exists. Use a different ID or delete it first.`
          );
        }
        return json(created);
      })
  );

  server.registerTool(
    "jobs_update",
    {
      description: `Update a tracked job's title, status, company, URL, salary, description, requirements, interview date and/or follow-up date. ${LOSSY_STATUS_NOTE} Setting status "applied" records that you applied.`,
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        title: z.string().optional().describe("New job title"),
        status: z
          .enum(JOB_STATUSES)
          .optional()
          .describe(
            "New pipeline status: saved, applied, interviewing, offer, rejected, or accepted"
          ),
        company: z.string().optional().describe("Hiring company name"),
        company_url: COMPANY_URL_SCHEMA.describe(
          "Company website URL (must be a valid URL, or empty to clear it)"
        ),
        salary_range: z
          .string()
          .optional()
          .describe("Compensation band, e.g. '$120k–$150k'"),
        job_description: z
          .array(z.string())
          .optional()
          .describe(
            "Posted job-description lines (replaces the existing list)"
          ),
        requirements: z
          .array(z.string())
          .optional()
          .describe("Role requirement lines (replaces the existing list)"),
        interview_date: z
          .string()
          .optional()
          .describe(
            "Scheduled interview date as an ISO calendar date (YYYY-MM-DD); pass an empty string to clear it"
          ),
        follow_up_at: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Follow-up reminder as an ISO date (YYYY-MM-DD, 09:00 UTC) or date-time; an empty string or null clears it"
          ),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const patch = updatePatch(args);
        if ("content" in patch) {
          return patch;
        }
        const jobs = await legacyJobs(mcpContext(env, caller));
        const updated = await jobs.update(args.job_id, patch);
        return updated ? json(updated) : notFound(args.job_id);
      })
  );

  server.registerTool(
    "jobs_delete",
    {
      description:
        "Delete a tracked job by its ID. On the new Job Tracker this archives it (hidden from the board, kept in your history); jobs are never purged through MCP.",
      inputSchema: { job_id: z.string().describe("Job identifier to delete") },
    },
    ({ job_id }) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const jobs = await legacyJobs(mcpContext(env, caller));
        if (!(await jobs.remove(job_id))) {
          return notFound(job_id);
        }
        return text(`Job "${job_id}" deleted.`);
      })
  );
}
