import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { getPortfolio, json, putPortfolio, text } from "../helpers";
import { optionalEmail } from "../schemas";
import { createEmptyPortfolio } from "../types";
import {
  affiliationKindEnum,
  buildAffiliation,
  portfolioEditUrl,
  portfolioPdfUrl,
  portfolioSaved,
  trackEnum,
} from "./portfolio-shared";

// Per-user portfolio management tools — create / get / list / delete / get_url
// plus the singleton-field updates (owner, affiliation, contact, meta). Mirrors
// cv-management.ts: ownership is stamped at create under `owner:portfolio:{id}`,
// list filters to the caller's own portfolios, and every update only writes the
// fields the caller actually passed ("only provided fields change").

export function registerPortfolioManagementTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "portfolio_get",
    {
      description:
        "Get the full portfolio document: owner (name, headline, affiliation, contact, track), submission target, cohort year, and every project.",
      inputSchema: {
        portfolio_id: z
          .string()
          .default("default")
          .describe("Portfolio identifier"),
      },
    },
    async ({ portfolio_id }) => {
      const data = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!data) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      return json(data);
    }
  );

  server.registerTool(
    "portfolio_list",
    {
      description:
        "List all stored portfolios you own, with their IDs, owner names, and headlines.",
      inputSchema: {},
    },
    async () => {
      // Only the `portfolio:{id}` blobs match this prefix; the ownership stamps
      // use a different prefix (`owner:portfolio:{id}`), so they're excluded.
      const list = await env.PORTFOLIO_KV.list<{
        fullName: string;
        headline: string;
      }>({ prefix: "portfolio:" });
      let portfolios = list.keys.map((k) => ({
        id: k.name.replace("portfolio:", ""),
        fullName: k.metadata?.fullName ?? "",
        headline: k.metadata?.headline ?? "",
      }));
      // Non-admins only see portfolios they own (owner stamped at create time).
      if (caller && !caller.isAdmin) {
        const email = caller.email;
        const checked = await Promise.all(
          portfolios.map(async (pf) => ({
            pf,
            owner: await env.PORTFOLIO_KV.get(`owner:portfolio:${pf.id}`),
          }))
        );
        portfolios = checked.filter((c) => c.owner === email).map((c) => c.pf);
      }
      if (portfolios.length === 0) {
        return text("No portfolios found. Use portfolio_create to create one.");
      }
      return json(portfolios);
    }
  );

  server.registerTool(
    "portfolio_create",
    {
      description:
        "Create a new blank portfolio. The id must be unique — re-using an existing id is rejected (create never overwrites). Returns the new portfolio id and its shareable edit URL.",
      inputSchema: {
        portfolio_id: z
          .string()
          .min(1)
          .describe(
            "Unique portfolio identifier (slug), e.g. 'jane-ada-2025'."
          ),
        full_name: z.string().default("").describe("Owner's full name."),
        email: optionalEmail.optional().describe("Owner's contact email."),
        headline: z
          .string()
          .optional()
          .describe("Short positioning line / desired area of expertise."),
        track: trackEnum
          .optional()
          .describe("Primary focus area (defaults to tech)."),
      },
    },
    async ({ portfolio_id, full_name, email, headline, track }) => {
      const existing = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (existing) {
        return text(
          `Portfolio "${portfolio_id}" already exists. Use a different id or delete it first.`
        );
      }
      const portfolio = createEmptyPortfolio();
      portfolio.owner.fullName = full_name;
      if (email !== undefined) {
        portfolio.owner.contact.email = email;
      }
      if (headline !== undefined) {
        portfolio.owner.headline = headline;
      }
      if (track !== undefined) {
        portfolio.owner.track = track;
      }
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      if (caller) {
        await env.PORTFOLIO_KV.put(
          `owner:portfolio:${portfolio_id}`,
          caller.email
        );
      }
      return portfolioSaved(
        `Portfolio "${portfolio_id}" created successfully.`,
        portfolio_id
      );
    }
  );

  server.registerTool(
    "portfolio_delete",
    {
      description: "Permanently delete a portfolio by its id.",
      inputSchema: {
        portfolio_id: z.string().describe("Portfolio identifier to delete"),
      },
    },
    async ({ portfolio_id }) => {
      const existing = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!existing) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      await env.PORTFOLIO_KV.delete(`portfolio:${portfolio_id}`);
      await env.PORTFOLIO_KV.delete(`owner:portfolio:${portfolio_id}`);
      return text(`Portfolio "${portfolio_id}" deleted.`);
    }
  );

  server.registerTool(
    "portfolio_get_url",
    {
      description:
        "Get the shareable URLs for a portfolio: the editable web URL (auto-saves under your token) and the print-to-PDF URL.",
      inputSchema: { portfolio_id: z.string().default("default") },
    },
    async ({ portfolio_id }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      return text(
        `Edit URL (opens the builder, auto-saves under your token):\n${portfolioEditUrl(portfolio_id)}\n\nPrint / PDF URL:\n${portfolioPdfUrl(portfolio_id)}`
      );
    }
  );

  server.registerTool(
    "portfolio_update_owner",
    {
      description:
        "Update the owner's top-level fields (full name, headline, track). Only provided fields are changed. Use portfolio_set_affiliation for the student/alumni/professional block and portfolio_update_contact for contact details.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        full_name: z.string().optional(),
        headline: z
          .string()
          .optional()
          .describe("Short positioning line (max 64 chars)."),
        track: trackEnum.optional(),
      },
    },
    async ({ portfolio_id, full_name, headline, track }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      if (full_name !== undefined) {
        portfolio.owner.fullName = full_name;
      }
      if (headline !== undefined) {
        portfolio.owner.headline = headline;
      }
      if (track !== undefined) {
        portfolio.owner.track = track;
      }
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved("Owner updated.", portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_set_affiliation",
    {
      description:
        "Set the owner's affiliation block. `kind` selects the shape: student/alumni require institution; professional and independent have all-optional fields. Replaces the whole affiliation with the fields relevant to the chosen kind.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        kind: affiliationKindEnum,
        institution: z
          .string()
          .optional()
          .describe("Required for student/alumni."),
        program: z.string().optional().describe("Degree or program of study."),
        semester: z.number().int().optional().describe("student only."),
        graduation_year: z.number().int().optional().describe("alumni only."),
        organization: z.string().optional().describe("professional only."),
        job_title: z.string().optional().describe("professional only."),
        years_experience: z
          .number()
          .int()
          .optional()
          .describe("professional only."),
        note: z.string().optional().describe("independent only (free text)."),
      },
    },
    async ({ portfolio_id, kind, ...rest }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      if (
        (kind === "student" || kind === "alumni") &&
        !rest.institution?.trim()
      ) {
        return text(
          `Affiliation kind "${kind}" requires a non-empty institution.`
        );
      }
      portfolio.owner.affiliation = buildAffiliation({ kind, ...rest });
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(`Affiliation set to "${kind}".`, portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_update_contact",
    {
      description:
        "Update the owner's contact details (email, phone, website URL). Only provided fields are changed. Manage social links with portfolio_add_social / portfolio_update_social / portfolio_remove_social.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        email: optionalEmail.optional(),
        phone: z.string().optional(),
        website_url: z
          .string()
          .optional()
          .describe("Personal portfolio site URL."),
      },
    },
    async ({ portfolio_id, email, phone, website_url }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      if (email !== undefined) {
        portfolio.owner.contact.email = email;
      }
      if (phone !== undefined) {
        portfolio.owner.contact.phone = phone;
      }
      if (website_url !== undefined) {
        portfolio.owner.contact.websiteUrl = website_url;
      }
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved("Contact updated.", portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_update_meta",
    {
      description:
        "Update portfolio metadata: the submission target (e.g. an academy or job application) and cohort year. Only provided fields are changed.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        submission_target: z.string().optional(),
        cohort_year: z.number().int().optional(),
      },
    },
    async ({ portfolio_id, submission_target, cohort_year }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      if (submission_target !== undefined) {
        portfolio.submissionTarget = submission_target;
      }
      if (cohort_year !== undefined) {
        portfolio.cohortYear = cohort_year;
      }
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved("Portfolio metadata updated.", portfolio_id);
    }
  );
}
