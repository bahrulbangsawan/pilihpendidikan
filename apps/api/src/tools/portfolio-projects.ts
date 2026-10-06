import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getPortfolio, json, putPortfolio, text } from "../helpers";
import type {
  PortfolioCollaboration,
  PortfolioMediaAsset,
  PortfolioProject,
} from "../types";
import { PORTFOLIO_MAX_PROJECTS } from "../types";
import {
  buildCollaboration,
  collaborationKindEnum,
  findProject,
  isValidImageRatio,
  mediaTypeEnum,
  portfolioSaved,
  projectTypeEnum,
  renumberProjects,
  trackEnum,
} from "./portfolio-shared";

// Per-user portfolio project collection: add / list / get / update / remove,
// plus the per-project media slot (set / remove). Mirrors the cv add/update/
// remove families — entries carry a stable `id` (so updates/removes are
// id-addressed, not index-addressed) and `order` is renumbered 1..N on add/remove
// so the "Project N of 5" labels stay contiguous. Updates only write the fields
// the caller passed.

const STRING_ARRAY = z.array(z.string());

// snake_case tool input field -> camelCase PortfolioProject field. Drives the
// data-driven patch in applyProjectPatch so portfolio_update_project stays a
// flat handler (keeps cognitive complexity low) — collaboration is the only
// field that needs bespoke union-building, handled separately below.
const PROJECT_FIELD_MAP: Record<string, keyof PortfolioProject> = {
  title: "title",
  year_accomplished: "yearAccomplished",
  role: "role",
  summary: "summary",
  description: "description",
  project_type: "projectType",
  impact: "impact",
  learnings: "learnings",
  publication_url: "publicationUrl",
  track: "track",
  scope_of_work: "scopeOfWork",
  technologies: "technologies",
  skills: "skills",
  repository_url: "repositoryUrl",
  marketplace_url: "marketplaceUrl",
  documentation_url: "documentationUrl",
};

// Apply a snake_case patch to a project in place: every provided scalar/array
// field is copied via PROJECT_FIELD_MAP; collaboration is rebuilt from
// collaboration_kind (+ team_size / group_role). Returns an error string when
// the patch is invalid (group without role), else null. "Only provided fields
// change" — undefined keys are skipped.
function applyProjectPatch(
  project: PortfolioProject,
  patch: Record<string, unknown>
): string | null {
  for (const [snake, camel] of Object.entries(PROJECT_FIELD_MAP)) {
    const value = patch[snake];
    if (value !== undefined) {
      (project as unknown as Record<string, unknown>)[camel] = value;
    }
  }
  const kind = patch.collaboration_kind as
    | PortfolioCollaboration["kind"]
    | undefined;
  if (kind !== undefined) {
    const groupRole =
      typeof patch.group_role === "string" ? patch.group_role : undefined;
    if (kind === "group" && !groupRole?.trim()) {
      return "A group project requires a non-empty group_role.";
    }
    const teamSize =
      typeof patch.team_size === "number" ? patch.team_size : undefined;
    project.collaboration = buildCollaboration(kind, teamSize, groupRole);
  }
  return null;
}

export function registerPortfolioProjectTools(
  server: McpServer,
  env: Env
): void {
  server.registerTool(
    "portfolio_add_project",
    {
      description: `Add a project to a portfolio (max ${PORTFOLIO_MAX_PROJECTS}). Returns the new project's id. For a group project pass collaboration_kind="group" and group_role.`,
      inputSchema: {
        portfolio_id: z.string().default("default"),
        title: z.string().describe("Project title (1 line, max 40 chars)."),
        year_accomplished: z
          .number()
          .int()
          .describe("Year the project was done."),
        role: z
          .string()
          .describe("Your role, e.g. 'iOS Developer' (max 40 chars)."),
        summary: z
          .string()
          .describe("One- or two-sentence summary (max 160 chars)."),
        description: z
          .string()
          .describe("Full concept/process narrative (max 270 chars)."),
        project_type: projectTypeEnum,
        collaboration_kind: collaborationKindEnum.default("individual"),
        team_size: z
          .number()
          .int()
          .optional()
          .describe("group only — team size."),
        group_role: z
          .string()
          .optional()
          .describe(
            "group only — your role in the group (required for groups)."
          ),
        impact: z.string().describe("The impact you made (max 180 chars)."),
        learnings: z.string().describe("What you learned (max 180 chars)."),
        publication_url: z.string().optional(),
        track: trackEnum.optional(),
        scope_of_work: STRING_ARRAY.optional().describe(
          "What you did (max 6 items, 32 chars each)."
        ),
        technologies: STRING_ARRAY.optional().describe(
          "Tech track — technologies (max 6 items)."
        ),
        skills: STRING_ARRAY.optional().describe(
          "Design/domain track — skills applied (max 6 items)."
        ),
        repository_url: z
          .string()
          .optional()
          .describe("tech track — public repo."),
        marketplace_url: z
          .string()
          .optional()
          .describe("tech track — App Store / marketplace."),
        documentation_url: z.string().optional(),
      },
    },
    async ({
      portfolio_id,
      collaboration_kind,
      team_size,
      group_role,
      ...fields
    }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      if (portfolio.projects.length >= PORTFOLIO_MAX_PROJECTS) {
        return text(
          `Portfolio already has the maximum of ${PORTFOLIO_MAX_PROJECTS} projects. Remove one before adding another.`
        );
      }
      if (collaboration_kind === "group" && !group_role?.trim()) {
        return text("A group project requires a non-empty group_role.");
      }
      const project: PortfolioProject = {
        id: crypto.randomUUID(),
        order: portfolio.projects.length + 1,
        title: fields.title,
        yearAccomplished: fields.year_accomplished,
        role: fields.role,
        summary: fields.summary,
        description: fields.description,
        projectType: fields.project_type,
        collaboration: buildCollaboration(
          collaboration_kind,
          team_size,
          group_role
        ),
        impact: fields.impact,
        learnings: fields.learnings,
        publicationUrl: fields.publication_url,
        track: fields.track,
        scopeOfWork: fields.scope_of_work ?? [],
        technologies: fields.technologies ?? [],
        skills: fields.skills ?? [],
        repositoryUrl: fields.repository_url,
        marketplaceUrl: fields.marketplace_url,
        documentationUrl: fields.documentation_url,
        media: [],
      };
      portfolio.projects.push(project);
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(
        `Project "${project.title}" added (id: ${project.id}).`,
        portfolio_id
      );
    }
  );

  server.registerTool(
    "portfolio_list_projects",
    {
      description:
        "List a portfolio's projects with their ids, order, and titles.",
      inputSchema: { portfolio_id: z.string().default("default") },
    },
    async ({ portfolio_id }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      return json(
        portfolio.projects.map((p) => ({
          id: p.id,
          order: p.order,
          title: p.title,
        }))
      );
    }
  );

  server.registerTool(
    "portfolio_get_project",
    {
      description: "Get a single project from a portfolio by its id.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        id: z
          .string()
          .describe("The project's id (from portfolio_list_projects)."),
      },
    },
    async ({ portfolio_id, id }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const found = findProject(portfolio, id);
      if (!found) {
        return text(
          `Project "${id}" not found in portfolio "${portfolio_id}".`
        );
      }
      return json(found.project);
    }
  );

  server.registerTool(
    "portfolio_update_project",
    {
      description:
        "Update an existing project by its id. Only provided fields change. Pass an array (scope_of_work / technologies / skills) to replace that whole list. To change collaboration pass collaboration_kind (+ group_role for groups).",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        id: z.string().describe("The project's id to update."),
        title: z.string().optional(),
        year_accomplished: z.number().int().optional(),
        role: z.string().optional(),
        summary: z.string().optional(),
        description: z.string().optional(),
        project_type: projectTypeEnum.optional(),
        collaboration_kind: collaborationKindEnum.optional(),
        team_size: z.number().int().optional(),
        group_role: z.string().optional(),
        impact: z.string().optional(),
        learnings: z.string().optional(),
        publication_url: z.string().optional(),
        track: trackEnum.optional(),
        scope_of_work: STRING_ARRAY.optional(),
        technologies: STRING_ARRAY.optional(),
        skills: STRING_ARRAY.optional(),
        repository_url: z.string().optional(),
        marketplace_url: z.string().optional(),
        documentation_url: z.string().optional(),
      },
    },
    async ({ portfolio_id, id, ...patch }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const found = findProject(portfolio, id);
      if (!found) {
        return text(
          `Project "${id}" not found in portfolio "${portfolio_id}".`
        );
      }
      const error = applyProjectPatch(found.project, patch);
      if (error) {
        return text(error);
      }
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(`Project "${id}" updated.`, portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_remove_project",
    {
      description:
        "Remove a project from a portfolio by its id. Remaining projects are renumbered.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        id: z.string().describe("The project's id to remove."),
      },
    },
    async ({ portfolio_id, id }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const found = findProject(portfolio, id);
      if (!found) {
        return text(
          `Project "${id}" not found in portfolio "${portfolio_id}".`
        );
      }
      portfolio.projects.splice(found.index, 1);
      renumberProjects(portfolio);
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(`Project "${id}" removed.`, portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_set_project_media",
    {
      description:
        "Set a project's media (the single 16:9 image or video slot). width and height must be exactly 16:9 (e.g. 1920×1080) or the call is rejected. For video, pass poster_url and publication_url. Replaces any existing media on the project. Note: large inline image data is best uploaded via the builder UI; this tool stores the url/dimensions you pass.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        id: z.string().describe("The project's id."),
        type: mediaTypeEnum,
        url: z.string().describe("Image/video URL (or data URI)."),
        alt: z.string().describe("Alt text (max 120 chars)."),
        width: z.number().int().positive().describe("Intrinsic pixel width."),
        height: z.number().int().positive().describe("Intrinsic pixel height."),
        caption: z
          .string()
          .optional()
          .describe("Optional caption (max 100 chars)."),
        poster_url: z
          .string()
          .optional()
          .describe("video only — still poster image (also 16:9)."),
        publication_url: z
          .string()
          .optional()
          .describe("video only — link to the online publication."),
      },
    },
    async ({
      portfolio_id,
      id,
      type,
      url,
      alt,
      width,
      height,
      caption,
      poster_url,
      publication_url,
    }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const found = findProject(portfolio, id);
      if (!found) {
        return text(
          `Project "${id}" not found in portfolio "${portfolio_id}".`
        );
      }
      if (!isValidImageRatio(width, height)) {
        return text(
          `Media must be exactly 16:9 (got ${width}×${height}). Use e.g. 1920×1080.`
        );
      }
      if (type === "video" && !(poster_url && publication_url)) {
        return text(
          "A video asset requires both poster_url and publication_url."
        );
      }
      const media: PortfolioMediaAsset = {
        type,
        url,
        alt,
        width,
        height,
        caption,
        posterUrl: poster_url,
        publicationUrl: publication_url,
      };
      found.project.media = [media];
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(`Media set on project "${id}".`, portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_remove_project_media",
    {
      description: "Remove a project's media (clears the image/video slot).",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        id: z.string().describe("The project's id."),
      },
    },
    async ({ portfolio_id, id }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const found = findProject(portfolio, id);
      if (!found) {
        return text(
          `Project "${id}" not found in portfolio "${portfolio_id}".`
        );
      }
      found.project.media = [];
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(
        `Media removed from project "${id}".`,
        portfolio_id
      );
    }
  );
}
