import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getCV, putCV, saved, stripBulletMarkers, text, uid } from "../helpers";
import {
  awardSchema,
  certificateSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  projectSchema,
  skillCategorySchema,
  volunteerSchema,
} from "../schemas";

export function registerCvAddTools(server: McpServer, env: Env): void {
  server.registerTool(
    "cv_add_experience",
    {
      description: "Add a new work experience entry.",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: experienceSchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.experience.push({
        id: uid(),
        ...entry,
        description: stripBulletMarkers(entry.description),
      });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Experience at "${entry.company}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_education",
    {
      description: "Add a new education entry.",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: educationSchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.education.push({ id: uid(), ...entry });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Education "${entry.degree}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_skill_category",
    {
      description:
        "Add a new skill category with items (e.g. 'Hard Skills': ['TypeScript', 'React']).",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: skillCategorySchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.skills.push({ id: uid(), ...entry });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Skill category "${entry.name}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_award",
    {
      description: "Add a new award entry.",
      inputSchema: { cv_id: z.string().default("default"), entry: awardSchema },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.awards.push({
        id: uid(),
        ...entry,
        description: stripBulletMarkers(entry.description),
      });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Award "${entry.title}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_certificate",
    {
      description: "Add a new certificate entry.",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: certificateSchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.certificates.push({ id: uid(), ...entry });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Certificate "${entry.name}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_language",
    {
      description: "Add a new language entry.",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: languageSchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.languages.push({ id: uid(), ...entry });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Language "${entry.language}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_project",
    {
      description: "Add a new project entry.",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: projectSchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.projects.push({
        id: uid(),
        ...entry,
        description: stripBulletMarkers(entry.description),
      });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Project "${entry.name}" added.`, cv_id);
    }
  );

  server.registerTool(
    "cv_add_volunteer",
    {
      description: "Add a new volunteer entry.",
      inputSchema: {
        cv_id: z.string().default("default"),
        entry: volunteerSchema,
      },
    },
    async ({ cv_id, entry }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      cv.volunteer.push({
        id: uid(),
        ...entry,
        description: stripBulletMarkers(entry.description),
      });
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Volunteer "${entry.organization}" added.`, cv_id);
    }
  );
}
