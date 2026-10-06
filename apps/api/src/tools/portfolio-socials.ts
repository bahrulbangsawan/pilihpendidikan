import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getPortfolio, putPortfolio, text } from "../helpers";
import type { PortfolioSocialLink } from "../types";
import { portfolioSaved } from "./portfolio-shared";

// Owner contact social links (LinkedIn / GitHub / Behance / …). These have no
// stable id in the data model, so they are addressed by 0-based index (use
// portfolio_get to see the current order). add appends; update patches the
// label/url at an index; remove drops the entry at an index.

function ensureSocials(socials: PortfolioSocialLink[] | undefined) {
  return socials ?? [];
}

export function registerPortfolioSocialTools(
  server: McpServer,
  env: Env
): void {
  server.registerTool(
    "portfolio_add_social",
    {
      description:
        "Add a social link to the owner's contact (e.g. LinkedIn, GitHub). Appends to the list.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        label: z.string().describe('e.g. "LinkedIn", "GitHub" (max 24 chars).'),
        url: z.string().describe("Full profile URL (max 200 chars)."),
      },
    },
    async ({ portfolio_id, label, url }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const socials = ensureSocials(portfolio.owner.contact.socials);
      socials.push({ label, url });
      portfolio.owner.contact.socials = socials;
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(
        `Social link "${label}" added (index ${socials.length - 1}).`,
        portfolio_id
      );
    }
  );

  server.registerTool(
    "portfolio_update_social",
    {
      description:
        "Update a social link by its 0-based index. Only provided fields change. Use portfolio_get to see the current order.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        index: z
          .number()
          .int()
          .nonnegative()
          .describe("0-based index of the link."),
        label: z.string().optional(),
        url: z.string().optional(),
      },
    },
    async ({ portfolio_id, index, label, url }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const socials = ensureSocials(portfolio.owner.contact.socials);
      const link = socials[index];
      if (!link) {
        return text(`No social link at index ${index}.`);
      }
      if (label !== undefined) {
        link.label = label;
      }
      if (url !== undefined) {
        link.url = url;
      }
      portfolio.owner.contact.socials = socials;
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(`Social link ${index} updated.`, portfolio_id);
    }
  );

  server.registerTool(
    "portfolio_remove_social",
    {
      description: "Remove a social link by its 0-based index.",
      inputSchema: {
        portfolio_id: z.string().default("default"),
        index: z
          .number()
          .int()
          .nonnegative()
          .describe("0-based index of the link."),
      },
    },
    async ({ portfolio_id, index }) => {
      const portfolio = await getPortfolio(env.PORTFOLIO_KV, portfolio_id);
      if (!portfolio) {
        return text(`Portfolio "${portfolio_id}" not found.`);
      }
      const socials = ensureSocials(portfolio.owner.contact.socials);
      if (!socials[index]) {
        return text(`No social link at index ${index}.`);
      }
      socials.splice(index, 1);
      portfolio.owner.contact.socials = socials;
      await putPortfolio(env.PORTFOLIO_KV, portfolio_id, portfolio);
      return portfolioSaved(`Social link ${index} removed.`, portfolio_id);
    }
  );
}
