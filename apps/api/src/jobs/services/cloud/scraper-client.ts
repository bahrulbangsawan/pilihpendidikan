// The api side of the scraper protocol (24 §3): POSTs a request body to the
// scraper Worker through the SCRAPER service binding (or, in dev only,
// SCRAPER_FALLBACK_URL) and validates the answer against the contract. Any
// transport failure, non-200 status, oversized or malformed answer becomes a
// `ScraperUnavailableError` (error class `engine_unavailable`, retried).

import type {
  DirectoryRequest,
  DirectoryResponse,
  ProbeRequest,
  ProbeResponse,
  ScrapeRequest,
  ScrapeResponse,
} from "@pilihpendidikan/jobs-contracts/cloud";
import {
  DirectoryResponseSchema,
  ProbeResponseSchema,
  SCRAPE_MAX_ITEMS,
  SCRAPER_MAX_BODY_BYTES,
  ScrapeResponseSchema,
} from "@pilihpendidikan/jobs-contracts/cloud";
import { z } from "zod";
import type { Env } from "../../../env";

export class ScraperUnavailableError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ScraperUnavailableError";
    this.status = status;
  }
}

/** Extra time on top of the request's own deadline before giving up. */
const TRANSPORT_GRACE_MS = 30_000;
const ORIGIN = "https://scraper.internal";
const TRAILING_SLASHES_RE = /\/+$/;

type ScraperEnv = Pick<Env, "SCRAPER" | "SCRAPER_FALLBACK_URL">;

export function scraperConfigured(env: ScraperEnv): boolean {
  return Boolean(env.SCRAPER_FALLBACK_URL || env.SCRAPER);
}

async function post(
  env: ScraperEnv,
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<unknown> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs + TRANSPORT_GRACE_MS),
  };
  let response: Response;
  try {
    if (env.SCRAPER_FALLBACK_URL) {
      const base = env.SCRAPER_FALLBACK_URL.replace(TRAILING_SLASHES_RE, "");
      response = await fetch(`${base}${path}`, init);
    } else if (env.SCRAPER) {
      response = await env.SCRAPER.fetch(`${ORIGIN}${path}`, init);
    } else {
      throw new ScraperUnavailableError(
        "No scraper is configured (SCRAPER binding or SCRAPER_FALLBACK_URL)."
      );
    }
  } catch (err) {
    if (err instanceof ScraperUnavailableError) {
      throw err;
    }
    const name = err instanceof Error ? err.name : "Error";
    throw new ScraperUnavailableError(
      name === "TimeoutError"
        ? "The scraper did not answer in time."
        : `The scraper could not be reached (${name}).`
    );
  }
  if (response.status !== 200) {
    throw new ScraperUnavailableError(
      `The scraper answered HTTP ${response.status}.`,
      response.status
    );
  }
  const text = await response.text();
  if (text.length > SCRAPER_MAX_BODY_BYTES) {
    throw new ScraperUnavailableError("The scraper answer is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ScraperUnavailableError("The scraper answer is not JSON.");
  }
}

function validated<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ScraperUnavailableError(
      `The scraper's ${what} answer does not match the contract (${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}).`
    );
  }
  return parsed.data;
}

/**
 * The scrape envelope with items left unvalidated: ingestion validates each
 * item on its own, so one malformed posting is counted `invalid` instead of
 * discarding the whole run.
 */
const ScrapeEnvelopeSchema = ScrapeResponseSchema.extend({
  items: z.array(z.unknown()).max(SCRAPE_MAX_ITEMS),
});
export type ScrapeEnvelope = Omit<ScrapeResponse, "items"> & {
  items: unknown[];
};

export async function scrape(
  env: ScraperEnv,
  request: ScrapeRequest
): Promise<ScrapeEnvelope> {
  const raw = await post(env, "/v1/scrape", request, request.deadline_ms);
  return validated(ScrapeEnvelopeSchema, raw, "scrape") as ScrapeEnvelope;
}

export async function probe(
  env: ScraperEnv,
  request: ProbeRequest,
  timeoutMs: number
): Promise<ProbeResponse> {
  const raw = await post(env, "/v1/probe", request, timeoutMs);
  return validated(ProbeResponseSchema, raw, "probe");
}

export async function readDirectory(
  env: ScraperEnv,
  request: DirectoryRequest,
  timeoutMs: number
): Promise<DirectoryResponse> {
  const raw = await post(env, "/v1/directory", request, timeoutMs);
  return validated(DirectoryResponseSchema, raw, "directory");
}
