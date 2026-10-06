import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getJob, putJob, text, uid } from "../helpers";
import type { JobItem, JobSection } from "../types";

function findSection(
  sections: JobSection[],
  sectionId: string
): JobSection | undefined {
  return sections.find((s) => s.id === sectionId);
}

// Item CRUD: operate on the `items[]` array inside a section, located by
// `section_id`, inside a job located by `job_id`. The ownership guard authorizes
// against `owner:job:{id}` (via job_id) before any handler here runs.
export function registerJobsItemsTools(server: McpServer, env: Env): void {
  server.registerTool(
    "jobs_item_add",
    {
      description: "Add an item to a section inside a tracked job.",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        section_id: z.string().describe("Section ID to add the item to"),
        title: z.string().min(1).describe("Item title/label"),
        notes: z.string().optional().describe("Free-text notes"),
        url: z.string().optional().describe("Related link (https://...)"),
        done: z
          .boolean()
          .optional()
          .describe("Whether the item is complete (default: false)"),
      },
    },
    async ({ job_id, section_id, title, notes, url, done }) => {
      const job = await getJob(env.JOBS_KV, job_id);
      if (!job) {
        return text(`Job "${job_id}" not found.`);
      }
      const section = findSection(job.sections, section_id);
      if (!section) {
        return text(`No section with id "${section_id}".`);
      }
      const item: JobItem = {
        id: uid(),
        title,
        notes: notes ?? "",
        url: url ?? "",
        done: done ?? false,
      };
      section.items.push(item);
      await putJob(env.JOBS_KV, job_id, job);
      return text(
        `Item "${title}" added to section "${section_id}" (item id: ${item.id}).`
      );
    }
  );

  server.registerTool(
    "jobs_item_update",
    {
      description:
        "Update an item inside a section of a tracked job by its item ID.",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        section_id: z.string().describe("Section ID containing the item"),
        item_id: z.string().describe("Item ID to update"),
        title: z.string().optional(),
        notes: z.string().optional(),
        url: z.string().optional(),
        done: z.boolean().optional(),
      },
    },
    async ({ job_id, section_id, item_id, title, notes, url, done }) => {
      const job = await getJob(env.JOBS_KV, job_id);
      if (!job) {
        return text(`Job "${job_id}" not found.`);
      }
      const section = findSection(job.sections, section_id);
      if (!section) {
        return text(`No section with id "${section_id}".`);
      }
      const item = section.items.find((i) => i.id === item_id);
      if (!item) {
        return text(`No item with id "${item_id}" in section "${section_id}".`);
      }
      if (title !== undefined) {
        item.title = title;
      }
      if (notes !== undefined) {
        item.notes = notes;
      }
      if (url !== undefined) {
        item.url = url;
      }
      if (done !== undefined) {
        item.done = done;
      }
      await putJob(env.JOBS_KV, job_id, job);
      return text(`Item "${item_id}" updated.`);
    }
  );

  server.registerTool(
    "jobs_item_delete",
    {
      description:
        "Delete an item from a section of a tracked job by its item ID.",
      inputSchema: {
        job_id: z.string().describe("Job identifier"),
        section_id: z.string().describe("Section ID containing the item"),
        item_id: z.string().describe("Item ID to delete"),
      },
    },
    async ({ job_id, section_id, item_id }) => {
      const job = await getJob(env.JOBS_KV, job_id);
      if (!job) {
        return text(`Job "${job_id}" not found.`);
      }
      const section = findSection(job.sections, section_id);
      if (!section) {
        return text(`No section with id "${section_id}".`);
      }
      const idx = section.items.findIndex((i) => i.id === item_id);
      if (idx === -1) {
        return text(`No item with id "${item_id}" in section "${section_id}".`);
      }
      section.items.splice(idx, 1);
      await putJob(env.JOBS_KV, job_id, job);
      return text(`Item "${item_id}" deleted.`);
    }
  );
}
