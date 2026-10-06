import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getJob, putJob, text, uid } from "../helpers";
import type { JobSection } from "../types";

// Section CRUD: operate on the `sections[]` array inside a job. Every tool takes
// `job_id` so the ownership guard can authorize against `owner:job:{id}` before
// the handler runs (owning the job authorizes mutating its sections).
export function registerJobsSectionsTools(server: McpServer, env: Env): void {
  server.registerTool(
    "jobs_section_add",
    {
      description:
        "Add a new section to a tracked job (e.g. 'Interviews', 'Tasks', 'Contacts').",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        name: z.string().min(1).describe("Section name"),
      },
    },
    async ({ job_id, name }) => {
      const job = await getJob(env.JOBS_KV, job_id);
      if (!job) {
        return text(`Job "${job_id}" not found.`);
      }
      const section: JobSection = { id: uid(), name, items: [] };
      job.sections.push(section);
      await putJob(env.JOBS_KV, job_id, job);
      return text(`Section "${name}" added (id: ${section.id}).`);
    }
  );

  server.registerTool(
    "jobs_section_update",
    {
      description: "Rename a section inside a tracked job by its section ID.",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        section_id: z.string().describe("Section ID to update"),
        name: z.string().min(1).describe("New section name"),
      },
    },
    async ({ job_id, section_id, name }) => {
      const job = await getJob(env.JOBS_KV, job_id);
      if (!job) {
        return text(`Job "${job_id}" not found.`);
      }
      const section = job.sections.find((s) => s.id === section_id);
      if (!section) {
        return text(`No section with id "${section_id}".`);
      }
      section.name = name;
      await putJob(env.JOBS_KV, job_id, job);
      return text(`Section "${section_id}" updated.`);
    }
  );

  server.registerTool(
    "jobs_section_delete",
    {
      description:
        "Delete a section (and all of its items) from a tracked job by its section ID.",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        section_id: z.string().describe("Section ID to delete"),
      },
    },
    async ({ job_id, section_id }) => {
      const job = await getJob(env.JOBS_KV, job_id);
      if (!job) {
        return text(`Job "${job_id}" not found.`);
      }
      const idx = job.sections.findIndex((s) => s.id === section_id);
      if (idx === -1) {
        return text(`No section with id "${section_id}".`);
      }
      job.sections.splice(idx, 1);
      await putJob(env.JOBS_KV, job_id, job);
      return text(`Section "${section_id}" deleted.`);
    }
  );
}
