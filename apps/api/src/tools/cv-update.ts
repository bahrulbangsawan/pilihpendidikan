import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getCV, putCV, saved, stripBulletMarkers, text } from "../helpers";
import { dateField, optionalDateField, optionalUrl } from "../schemas";

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function registerCvUpdateTools(server: McpServer, env: Env): void {
  server.registerTool(
    "cv_update_experience",
    {
      description:
        "Update an existing experience entry by its ID. Only provided fields are changed.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        company: z.string().optional(),
        url: optionalUrl.optional(),
        title: z.string().optional(),
        workType: z
          .enum(["", "full-time", "part-time", "internship"])
          .optional(),
        locationPolicy: z
          .enum(["", "work-from-office", "work-from-anywhere", "hybrid"])
          .optional(),
        startDate: z.string().regex(YEAR_MONTH_RE).optional(),
        endDate: optionalDateField.optional(),
        current: z.boolean().optional(),
        description: z.string().optional(),
      },
    },
    async ({ cv_id, id, description, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.experience.find((e) => e.id === id);
      if (!entry) {
        return text(`No experience entry with id "${id}".`);
      }
      Object.assign(entry, fields);
      if (description !== undefined) {
        entry.description = stripBulletMarkers(description);
      }
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Experience "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_education",
    {
      description:
        "Update an existing education entry by its ID. Only provided fields are changed.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        category: z
          .enum([
            "",
            "university",
            "college",
            "school",
            "polytechnic",
            "academy",
            "language-center",
            "online-platform",
            "professional-association",
          ])
          .optional(),
        institution: z.string().optional(),
        degree: z.string().optional(),
        gpa: z.string().optional(),
        startDate: z.string().regex(YEAR_MONTH_RE).optional(),
        endDate: optionalDateField.optional(),
        current: z.boolean().optional(),
      },
    },
    async ({ cv_id, id, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.education.find((e) => e.id === id);
      if (!entry) {
        return text(`No education entry with id "${id}".`);
      }
      Object.assign(entry, fields);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Education "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_skill_category",
    {
      description:
        "Update an existing skill category by its ID. Provide name to rename it, items to replace the full list.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        name: z
          .string()
          .optional()
          .describe("Category name (e.g. 'Hard Skills')"),
        items: z
          .array(z.string())
          .optional()
          .describe("Full replacement list of skill items"),
      },
    },
    async ({ cv_id, id, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.skills.find((e) => e.id === id);
      if (!entry) {
        return text(`No skill category with id "${id}".`);
      }
      Object.assign(entry, fields);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Skill category "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_award",
    {
      description:
        "Update an existing award entry by its ID. Only provided fields are changed.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        title: z.string().optional(),
        issuer: z.string().optional(),
        date: dateField.optional(),
        description: z.string().optional(),
        url: optionalUrl.optional(),
      },
    },
    async ({ cv_id, id, description, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.awards.find((e) => e.id === id);
      if (!entry) {
        return text(`No award with id "${id}".`);
      }
      Object.assign(entry, fields);
      if (description !== undefined) {
        entry.description = stripBulletMarkers(description);
      }
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Award "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_certificate",
    {
      description:
        "Update an existing certificate entry by its ID. Only provided fields are changed.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        name: z.string().optional(),
        issuer: z.string().optional(),
        date: dateField.optional(),
        expiryDate: optionalDateField.optional(),
        credentialId: z.string().optional(),
        url: optionalUrl.optional(),
      },
    },
    async ({ cv_id, id, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.certificates.find((e) => e.id === id);
      if (!entry) {
        return text(`No certificate with id "${id}".`);
      }
      Object.assign(entry, fields);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Certificate "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_language",
    {
      description: "Update an existing language entry by its ID.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        language: z.string().optional(),
        proficiency: z
          .string()
          .optional()
          .describe("e.g. Native, Fluent, Intermediate, Basic"),
      },
    },
    async ({ cv_id, id, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.languages.find((e) => e.id === id);
      if (!entry) {
        return text(`No language with id "${id}".`);
      }
      Object.assign(entry, fields);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Language "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_project",
    {
      description:
        "Update an existing project entry by its ID. Only provided fields are changed.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        name: z.string().optional(),
        url: optionalUrl.optional(),
        description: z.string().optional(),
      },
    },
    async ({ cv_id, id, description, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.projects.find((e) => e.id === id);
      if (!entry) {
        return text(`No project with id "${id}".`);
      }
      Object.assign(entry, fields);
      if (description !== undefined) {
        entry.description = stripBulletMarkers(description);
      }
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Project "${id}" updated.`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_volunteer",
    {
      description:
        "Update an existing volunteer entry by its ID. Only provided fields are changed.",
      inputSchema: {
        cv_id: z.string().default("default"),
        id: z.string().describe("Entry ID from cv_list_section"),
        organization: z.string().optional(),
        role: z.string().optional(),
        startDate: z.string().regex(YEAR_MONTH_RE).optional(),
        endDate: optionalDateField.optional(),
        current: z.boolean().optional(),
        description: z.string().optional(),
      },
    },
    async ({ cv_id, id, description, ...fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entry = cv.volunteer.find((e) => e.id === id);
      if (!entry) {
        return text(`No volunteer entry with id "${id}".`);
      }
      Object.assign(entry, fields);
      if (description !== undefined) {
        entry.description = stripBulletMarkers(description);
      }
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Volunteer "${id}" updated.`, cv_id);
    }
  );
}
