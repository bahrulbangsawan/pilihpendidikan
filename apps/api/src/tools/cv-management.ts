import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import {
  cvEditUrl,
  getCV,
  json,
  normalizeLinkedIn,
  pdfUrl,
  putCV,
  saved,
  text,
} from "../helpers";
import { optionalEmail, optionalUrl } from "../schemas";
import type { CVData } from "../types";
import { createEmptyCV, DEFAULT_SECTION_ORDER } from "../types";

export function registerCvManagementTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "cv_get",
    {
      description:
        "Get the full CV data. Returns all sections including personal info, summary, experience, education, skills, awards, certificates, languages, projects, and volunteer entries.",
      inputSchema: {
        cv_id: z.string().default("default").describe("CV identifier"),
      },
    },
    async ({ cv_id }) => {
      const data = await getCV(env.CV_KV, cv_id);
      if (!data) {
        return text(`CV "${cv_id}" not found.`);
      }
      return json(data);
    }
  );

  server.registerTool(
    "cv_list",
    {
      description: "List all stored CVs with their IDs, names, and job titles.",
      inputSchema: {},
    },
    async () => {
      const list = await env.CV_KV.list<{ fullName: string; jobTitle: string }>(
        { prefix: "cv:" }
      );
      let cvs = list.keys.map((k) => ({
        id: k.name.replace("cv:", ""),
        fullName: k.metadata?.fullName ?? "",
        jobTitle: k.metadata?.jobTitle ?? "",
      }));
      // Non-admins only see CVs they own (owner stamped at create time).
      if (caller && !caller.isAdmin) {
        const email = caller.email;
        const checked = await Promise.all(
          cvs.map(async (cv) => ({
            cv,
            owner: await env.CV_KV.get(`owner:cv:${cv.id}`),
          }))
        );
        cvs = checked.filter((c) => c.owner === email).map((c) => c.cv);
      }
      if (cvs.length === 0) {
        return text("No CVs found. Use cv_create to create one.");
      }
      return json(cvs);
    }
  );

  server.registerTool(
    "cv_create",
    {
      description: "Create a new blank CV. Returns the new CV ID.",
      inputSchema: {
        cv_id: z.string().default("default").describe("CV identifier"),
        full_name: z.string().default("").describe("Full name for the CV"),
        job_title: z.string().default("").describe("Job title / headline"),
      },
    },
    async ({ cv_id, full_name, job_title }) => {
      const existing = await getCV(env.CV_KV, cv_id);
      if (existing) {
        return text(
          `CV "${cv_id}" already exists. Use a different ID or delete it first.`
        );
      }
      const cv = createEmptyCV();
      cv.personalInfo.fullName = full_name;
      cv.personalInfo.jobTitle = job_title;
      await putCV(env.CV_KV, cv_id, cv);
      if (caller) {
        await env.CV_KV.put(`owner:cv:${cv_id}`, caller.email);
      }
      return saved(`CV "${cv_id}" created successfully.`, cv_id);
    }
  );

  server.registerTool(
    "cv_delete",
    {
      description: "Permanently delete a CV by its ID.",
      inputSchema: { cv_id: z.string().describe("CV identifier to delete") },
    },
    async ({ cv_id }) => {
      const existing = await getCV(env.CV_KV, cv_id);
      if (!existing) {
        return text(`CV "${cv_id}" not found.`);
      }
      await env.CV_KV.delete(`cv:${cv_id}`);
      await env.CV_KV.delete(`owner:cv:${cv_id}`);
      return text(`CV "${cv_id}" deleted.`);
    }
  );

  server.registerTool(
    "cv_update_personal_info",
    {
      description:
        "Update personal information fields (name, job title, email, phone, location, LinkedIn). Only provided fields are updated.",
      inputSchema: {
        cv_id: z.string().default("default"),
        full_name: z.string().optional(),
        job_title: z.string().optional(),
        email: optionalEmail.optional(),
        phone: z.string().optional(),
        location: z.string().optional(),
        linked_in: z.string().optional(),
        photo_url: optionalUrl.optional(),
        use_photo: z.boolean().optional(),
      },
    },
    async ({
      cv_id,
      full_name,
      job_title,
      email,
      phone,
      location,
      linked_in,
      photo_url,
      use_photo,
    }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      if (full_name !== undefined) {
        cv.personalInfo.fullName = full_name;
      }
      if (job_title !== undefined) {
        cv.personalInfo.jobTitle = job_title;
      }
      if (email !== undefined) {
        cv.personalInfo.email = email;
      }
      if (phone !== undefined) {
        cv.personalInfo.phone = phone;
      }
      if (location !== undefined) {
        cv.personalInfo.location = location;
      }
      if (linked_in !== undefined) {
        cv.personalInfo.linkedIn = normalizeLinkedIn(linked_in);
      }
      if (photo_url !== undefined) {
        cv.personalInfo.photoUrl = photo_url;
      }
      if (use_photo !== undefined) {
        cv.personalInfo.usePhoto = use_photo;
      }
      await putCV(env.CV_KV, cv_id, cv);
      return saved("Personal info updated.", cv_id);
    }
  );

  server.registerTool(
    "cv_update_summary",
    {
      description: "Update the professional summary text.",
      inputSchema: {
        cv_id: z.string().default("default"),
        summary: z.string().describe("The new professional summary text"),
        title: z
          .string()
          .optional()
          .describe("Custom section title (default: 'Summary')"),
      },
    },
    async ({ cv_id, summary, title }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.summary = summary;
      if (title) {
        cv.summaryTitle = title;
      }
      await putCV(env.CV_KV, cv_id, cv);
      return saved("Summary updated.", cv_id);
    }
  );

  server.registerTool(
    "cv_reorder_sections",
    {
      description:
        "Reorder the CV sections. Provide the full ordered list of section IDs.",
      inputSchema: {
        cv_id: z.string().default("default"),
        order: z.array(
          z.enum([
            "summary",
            "experience",
            "education",
            "skills",
            "awards",
            "certificates",
            "languages",
            "projects",
            "volunteer",
          ])
        ),
      },
    },
    async ({ cv_id, order }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const required = new Set(DEFAULT_SECTION_ORDER);
      const provided = new Set(order);
      // Reject duplicates: a `Set` collapses repeats, so a size mismatch means
      // the caller sent the same section twice. Combined with the all-present
      // check below this pins `order` to exactly the 9 valid sections, once
      // each. See findings/MCP_AUDIT.md F6.
      if (provided.size !== order.length) {
        return text("Order contains duplicate sections.");
      }
      for (const s of required) {
        if (!provided.has(s)) {
          return text(`Missing section "${s}" in order.`);
        }
      }
      cv.sectionOrder = order;
      await putCV(env.CV_KV, cv_id, cv);
      return saved("Section order updated.", cv_id);
    }
  );

  server.registerTool(
    "cv_rename_section",
    {
      description:
        "Rename a section's display title (e.g. rename 'Experience' to 'Work History').",
      inputSchema: {
        cv_id: z.string().default("default"),
        section: z.enum([
          "summary",
          "experience",
          "education",
          "skills",
          "awards",
          "certificates",
          "languages",
          "projects",
          "volunteer",
        ]),
        title: z.string().describe("New display title for the section"),
      },
    },
    async ({ cv_id, section, title }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const key = `${section}Title` as keyof CVData;
      if (key in cv) {
        (cv as unknown as Record<string, unknown>)[key] = title;
        await putCV(env.CV_KV, cv_id, cv);
        return saved(`Section "${section}" renamed to "${title}".`, cv_id);
      }
      return text(`Cannot rename section "${section}".`);
    }
  );

  server.registerTool(
    "cv_get_url",
    {
      description:
        "Get the shareable URLs for a CV: the editable web URL (auto-saves under your token) and the print-to-PDF URL.",
      inputSchema: { cv_id: z.string().default("default") },
    },
    async ({ cv_id }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      // Canonical `?id=` edit URL (the legacy `?cv=` still resolves in-app) plus
      // the canonical print/PDF route served from the api host.
      return text(
        `Edit URL (opens the CV builder, auto-saves under your token):\n${cvEditUrl(cv_id)}\n\nPrint / PDF URL:\n${pdfUrl("cv", cv_id)}`
      );
    }
  );
}
