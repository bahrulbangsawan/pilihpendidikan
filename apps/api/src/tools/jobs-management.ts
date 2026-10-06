import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { getJob, json, putJob, text } from "../helpers";
import { jobIdsOwnedBy } from "../ownership";
import type { JobData } from "../types";
import { createEmptyJob, JOB_STATUSES } from "../types";

// Shared by jobs_create + jobs_update: a company URL must be a valid URL or the
// empty string (to leave unset / clear), and the param itself is optional. zod
// validates the URL server-side so a malformed value is rejected before write.
const COMPANY_URL_SCHEMA = z.union([z.literal(""), z.url()]).optional();

// Structured fields shared by jobs_create + jobs_update (snake_case tool params
// → camelCase JobData keys). Each is applied only when the caller supplied it,
// so an update leaves omitted fields untouched.
function applyJobFields(
  job: JobData,
  args: {
    company?: string;
    company_url?: string;
    salary_range?: string;
    job_description?: string[];
    requirements?: string[];
    interview_date?: string;
  }
): void {
  if (args.company !== undefined) {
    job.company = args.company;
  }
  if (args.company_url !== undefined) {
    job.companyUrl = args.company_url;
  }
  if (args.salary_range !== undefined) {
    job.salaryRange = args.salary_range;
  }
  if (args.job_description !== undefined) {
    job.jobDescription = args.job_description;
  }
  if (args.requirements !== undefined) {
    job.requirements = args.requirements;
  }
  if (args.interview_date !== undefined) {
    job.interviewDate = args.interview_date;
  }
}

// Top-level CRUD for the per-user jobs tracker. Mirrors invoice-management.ts:
// jobs_list/jobs_create self-scope (list filters by owner, create stamps it),
// so the ownership guard (ownership-guard.ts) lets them through; every other
// tool here is gated by the guard on `owner:job:{id}` before its handler runs.
export function registerJobsManagementTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "jobs_list",
    {
      description:
        "List the job applications you are tracking, with their IDs, titles, and statuses.",
      inputSchema: {},
    },
    async () => {
      const list = await env.JOBS_KV.list<{
        title: string;
        status: string;
        interviewDate: string;
      }>({
        prefix: "job:",
      });
      let jobs = list.keys.map((k) => ({
        id: k.name.replace("job:", ""),
        title: k.metadata?.title ?? "",
        status: k.metadata?.status ?? "",
        interviewDate: k.metadata?.interviewDate ?? "",
      }));
      // Non-admins only see jobs they own — resolved from the authoritative
      // `owner:job:{id}` stamp via the shared resolver (the SAME source GET
      // /api/jobs uses), so the MCP client and the web UI always agree.
      if (caller && !caller.isAdmin) {
        const owned = await jobIdsOwnedBy(
          env,
          caller.email,
          jobs.map((job) => job.id)
        );
        jobs = jobs.filter((job) => owned.has(job.id));
      }
      if (jobs.length === 0) {
        return text("No jobs found. Use jobs_create to start tracking one.");
      }
      return json(jobs);
    }
  );

  server.registerTool(
    "jobs_get",
    {
      description:
        "Get the full data of a tracked job by its ID, including its sections and items.",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
      },
    },
    async ({ job_id }) => {
      const data = await getJob(env.JOBS_KV, job_id);
      if (!data) {
        return text(`Job "${job_id}" not found.`);
      }
      return json(data);
    }
  );

  server.registerTool(
    "jobs_create",
    {
      description:
        "Create a new job-application tracker entry. Re-creating an existing ID is rejected — it never overwrites or hijacks another owner's job.",
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
    async (args) => {
      const existing = await getJob(env.JOBS_KV, args.job_id);
      if (existing) {
        return text(
          `Job "${args.job_id}" already exists. Use a different ID or delete it first.`
        );
      }
      const job = createEmptyJob();
      job.id = args.job_id;
      job.title = args.title;
      if (args.status) {
        job.status = args.status;
      }
      applyJobFields(job, args);
      await putJob(env.JOBS_KV, args.job_id, job);
      if (caller) {
        await env.JOBS_KV.put(`owner:job:${args.job_id}`, caller.email);
      }
      return json(job);
    }
  );

  server.registerTool(
    "jobs_update",
    {
      description:
        "Update a tracked job's title, status, company, URL, salary, description, requirements, and/or interview date.",
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
      },
    },
    async (args) => {
      const job = await getJob(env.JOBS_KV, args.job_id);
      if (!job) {
        return text(`Job "${args.job_id}" not found.`);
      }
      if (args.title !== undefined) {
        job.title = args.title;
      }
      if (args.status !== undefined) {
        job.status = args.status;
      }
      applyJobFields(job, args);
      await putJob(env.JOBS_KV, args.job_id, job);
      return json(job);
    }
  );

  server.registerTool(
    "jobs_delete",
    {
      description:
        "Permanently delete a tracked job by its ID (also clears its ownership record).",
      inputSchema: { job_id: z.string().describe("Job identifier to delete") },
    },
    async ({ job_id }) => {
      const existing = await getJob(env.JOBS_KV, job_id);
      if (!existing) {
        return text(`Job "${job_id}" not found.`);
      }
      await env.JOBS_KV.delete(`job:${job_id}`);
      await env.JOBS_KV.delete(`owner:job:${job_id}`);
      return text(`Job "${job_id}" deleted.`);
    }
  );
}
