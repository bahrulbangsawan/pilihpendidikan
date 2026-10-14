// Probe → catalog decision (24 §7.2). Deterministic first: protection,
// login walls and robots decide health; a verified feed decides the strategy;
// structured data and job-like links decide whether it is a job board. Only
// a verified RSS/Atom feed with items, allowed by robots and unprotected, is
// enabled automatically; everything else waits for an operator. The AI
// classifier (ai.ts) is consulted by the caller only when the category stays
// `unknown`.

import type { ProbeResponse } from "@pilihpendidikan/jobs-contracts/cloud";
import type {
  CloudSourceCategory,
  CloudSourceHealth,
  CloudStrategy,
} from "@pilihpendidikan/jobs-contracts/enums";

export interface ProbeDecision {
  category: CloudSourceCategory;
  enabled: boolean;
  health: CloudSourceHealth;
  /** Null when the probe found nothing about logins. */
  authRequired: boolean;
  /** Set when the strategy should change (only from `none`). */
  strategy: CloudStrategy | null;
  strategyConfig: Record<string, unknown> | null;
  statusReason: string;
}

/** Job-like same-site links before a page counts as a board. */
export const JOB_LINK_THRESHOLD = 5;

function feedDecision(probe: ProbeResponse): ProbeDecision | null {
  const feed = probe.feeds
    .filter((f) => f.items > 0)
    .sort((a, b) => b.items - a.items)[0];
  if (!feed) {
    return null;
  }
  if (feed.type === "json_api") {
    return {
      category: "job_board",
      enabled: false,
      health: "ACTIVE",
      authRequired: false,
      strategy: null,
      strategyConfig: null,
      statusReason: `A JSON API with ${feed.items} items was found at ${feed.url}. Map its fields in the json_api strategy, then enable the source.`,
    };
  }
  return {
    category: "job_board",
    enabled: true,
    health: "ACTIVE",
    authRequired: false,
    strategy: "rss",
    strategyConfig: {
      url: feed.url,
      title_pattern: "title",
      fetch_details: true,
      defaults: { workplace_type: "remote" },
    },
    statusReason: `Verified ${feed.type.toUpperCase()} feed with ${feed.items} items at ${feed.url}.`,
  };
}

/** The catalog decision for a probed site. */
export function decideFromProbe(probe: ProbeResponse): ProbeDecision {
  const base = {
    authRequired: false,
    strategy: null,
    strategyConfig: null,
  } as const;
  if (probe.error) {
    const cls = probe.error.error_class;
    if (cls === "challenge_detected" || cls === "access_denied") {
      return {
        ...base,
        category: "unknown",
        enabled: true,
        health: "BLOCKED",
        statusReason: `The site refuses our honest crawler (${cls}${probe.error.http_status ? `, HTTP ${probe.error.http_status}` : ""}). Pilih never bypasses protections.`,
      };
    }
    if (cls === "robots_disallowed") {
      return {
        ...base,
        category: "unknown",
        enabled: true,
        health: "BLOCKED",
        statusReason: "robots.txt disallows the page for our crawler.",
      };
    }
    if (!probe.reachable) {
      return {
        ...base,
        category: "defunct",
        enabled: false,
        health: "UNSUPPORTED",
        statusReason:
          `The site could not be reached (${cls}): ${probe.error.message}`.slice(
            0,
            1000
          ),
      };
    }
  }
  if (probe.protection) {
    return {
      ...base,
      category: "unknown",
      enabled: true,
      health: "BLOCKED",
      statusReason: `The site shows a protection page (${probe.protection}) to our crawler. Pilih never bypasses protections.`,
    };
  }
  if (probe.robots.allowed === false) {
    return {
      ...base,
      category: "unknown",
      enabled: true,
      health: "BLOCKED",
      statusReason: "robots.txt disallows the page for our crawler.",
    };
  }
  if (probe.auth_wall) {
    return {
      ...base,
      authRequired: true,
      category: "job_board",
      enabled: true,
      health: "AUTH_REQUIRED",
      statusReason:
        "Listings are behind a login, sign-up or paywall. Pilih does not log in or collect credentials for discovery.",
    };
  }
  const feed = feedDecision(probe);
  if (feed) {
    return feed;
  }
  if (probe.jsonld_job_postings > 0) {
    return {
      ...base,
      category: "job_board",
      enabled: false,
      health: "ACTIVE",
      strategy: "json_ld",
      strategyConfig: {
        listing_url: probe.final_url ?? probe.url,
        listing_jsonld: true,
        detail_link_selector: "a[href*='job']::attr(href)",
      },
      statusReason: `The page carries ${probe.jsonld_job_postings} JSON-LD JobPosting entries. Check the detail-link selector, then enable the source.`,
    };
  }
  if (probe.job_link_count >= JOB_LINK_THRESHOLD) {
    return {
      ...base,
      category: "job_board",
      enabled: false,
      health: "ACTIVE",
      statusReason: `Found ${probe.job_link_count} job-like links but no feed or structured data. Configure the html_selectors (or opt-in browser) strategy, then enable the source.`,
    };
  }
  return {
    ...base,
    category: "unknown",
    enabled: false,
    health: "UNSUPPORTED",
    statusReason:
      "No job listings, feed or structured job data were found on the page.",
  };
}
