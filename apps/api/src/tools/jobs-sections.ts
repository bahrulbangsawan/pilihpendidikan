import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { text, uid } from "../helpers";
import { editJobSections } from "../jobs/legacy/mcp";
import type { JobSection } from "../types";

// Section CRUD: operate on the `sections[]` array inside a job. Every tool takes
// `job_id` so the ownership guard can authorize it before the handler runs
// (owning the job authorizes mutating its sections).
export function registerJobsSectionsTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
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
    ({ job_id, name }) =>
      editJobSections(env, caller, job_id, (sections) => {
        const section: JobSection = { id: uid(), name, items: [] };
        sections.push(section);
        return {
          sections,
          result: text(`Section "${name}" added (id: ${section.id}).`),
        };
      })
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
    ({ job_id, section_id, name }) =>
      editJobSections(env, caller, job_id, (sections) => {
        const section = sections.find((s) => s.id === section_id);
        if (!section) {
          return { result: text(`No section with id "${section_id}".`) };
        }
        section.name = name;
        return {
          sections,
          result: text(`Section "${section_id}" updated.`),
        };
      })
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
    ({ job_id, section_id }) =>
      editJobSections(env, caller, job_id, (sections) => {
        const idx = sections.findIndex((s) => s.id === section_id);
        if (idx === -1) {
          return { result: text(`No section with id "${section_id}".`) };
        }
        sections.splice(idx, 1);
        return {
          sections,
          result: text(`Section "${section_id}" deleted.`),
        };
      })
  );
}
