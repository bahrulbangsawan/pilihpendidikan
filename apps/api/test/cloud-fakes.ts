// Test doubles for cloud discovery (job-tracker-spec/24): a recording
// `jobs-scrape` queue whose `drain()` runs the real consumer with Workers
// retry / DLQ semantics (max_retries 3), and a scripted scraper standing in
// for the SCRAPER service binding.

import type {
  CloudPostingItem,
  CloudQueueMessage,
  DirectoryResponse,
  ProbeResponse,
  ScrapeRequest,
  ScrapeResponse,
} from "@pilihpendidikan/jobs-contracts/cloud";
import {
  contentHash,
  fingerprint,
  primaryLocation,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { Env } from "../src/env";
import type { KernelDeps } from "../src/jobs/core/deps";
import {
  handleCloudBatch,
  JOBS_SCRAPE_DLQ,
  JOBS_SCRAPE_QUEUE,
} from "../src/jobs/cloud/consumer";
import { createCtx } from "./fakes";

export interface CloudRecordedMessage {
  attempts: number;
  body: CloudQueueMessage;
  delaySeconds?: number;
  id: string;
}

export interface FakeScrapeQueue {
  drain(
    env: Env,
    options?: { deps?: KernelDeps; maxRounds?: number }
  ): Promise<{
    acked: number;
    deadLettered: number;
    retried: number;
  }>;
  readonly pending: CloudRecordedMessage[];
  queue: Queue<CloudQueueMessage>;
  readonly retries: Array<{ delaySeconds?: number; type: string }>;
  readonly sent: CloudRecordedMessage[];
}

const MAX_RETRIES = 3;

export function createFakeScrapeQueue(): FakeScrapeQueue {
  const sent: CloudRecordedMessage[] = [];
  const pending: CloudRecordedMessage[] = [];
  const dlq: CloudRecordedMessage[] = [];
  const retries: Array<{ delaySeconds?: number; type: string }> = [];
  const enqueue = (body: CloudQueueMessage) => {
    const message = {
      id: crypto.randomUUID(),
      body: JSON.parse(JSON.stringify(body)),
      attempts: 1,
    };
    sent.push(message);
    pending.push(message);
  };
  const queue = {
    async send(body: CloudQueueMessage) {
      await Promise.resolve();
      enqueue(body);
    },
    async sendBatch(messages: Iterable<{ body: CloudQueueMessage }>) {
      await Promise.resolve();
      const list = [...messages];
      if (list.length > 100) {
        throw new Error("sendBatch takes at most 100 messages");
      }
      for (const m of list) {
        enqueue(m.body);
      }
    },
  };
  async function deliverOne(
    env: Env,
    name: string,
    message: CloudRecordedMessage,
    deps?: KernelDeps
  ): Promise<{ delaySeconds?: number; kind: "ack" | "retry" }> {
    let outcome: { delaySeconds?: number; kind: "ack" | "retry" } = {
      kind: "ack",
    };
    const batch = {
      queue: name,
      messages: [
        {
          id: message.id,
          timestamp: new Date(),
          body: message.body,
          attempts: message.attempts,
          ack: () => {
            outcome = { kind: "ack" };
          },
          retry: (opts?: { delaySeconds?: number }) => {
            outcome = { kind: "retry", delaySeconds: opts?.delaySeconds };
          },
        },
      ],
    } as unknown as MessageBatch<unknown>;
    const ctx = createCtx();
    await handleCloudBatch(batch, env, ctx, deps);
    await ctx.drain();
    return outcome;
  }
  return {
    queue: queue as unknown as Queue<CloudQueueMessage>,
    sent,
    pending,
    retries,
    async drain(env, options = {}) {
      const totals = { acked: 0, retried: 0, deadLettered: 0 };
      // Workers semantics: a retried message is redelivered until it has
      // been retried `max_retries` times, then it moves to the DLQ (from
      // which a retry is dropped).
      const settle = (
        message: CloudRecordedMessage,
        outcome: { delaySeconds?: number; kind: "ack" | "retry" },
        fromMain: boolean
      ) => {
        if (outcome.kind === "ack") {
          totals.acked += 1;
          return;
        }
        totals.retried += 1;
        retries.push({
          type: message.body.type,
          delaySeconds: outcome.delaySeconds,
        });
        if (!fromMain) {
          return;
        }
        if (message.attempts <= MAX_RETRIES) {
          pending.push({ ...message, attempts: message.attempts + 1 });
        } else {
          totals.deadLettered += 1;
          dlq.push({ ...message, attempts: 1 });
        }
      };
      for (let round = 0; round < (options.maxRounds ?? 100); round++) {
        const fromMain = pending.length > 0;
        const message = fromMain ? pending.shift() : dlq.shift();
        if (!message) {
          return totals;
        }
        const outcome = await deliverOne(
          env,
          fromMain ? JOBS_SCRAPE_QUEUE : JOBS_SCRAPE_DLQ,
          message,
          options.deps
        );
        settle(message, outcome, fromMain);
      }
      throw new Error("scrape queue did not drain");
    },
  };
}

export type ScrapeHandler = (
  request: ScrapeRequest
) => ScrapeResponse | Promise<ScrapeResponse>;

export interface FakeScraper {
  binding: Fetcher;
  directory: (() => DirectoryResponse) | null;
  probe: ((url: string) => ProbeResponse) | null;
  readonly requests: Array<{ body: unknown; path: string }>;
  scrape: ScrapeHandler | null;
  /** Throw on every call (scraper down). */
  down: boolean;
}

export const ENGINE = {
  scraper: "0.1.0",
  pilih_jobs: "0.1.0",
  scrapling: "0.4.15",
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

export function createFakeScraper(): FakeScraper {
  const fake: FakeScraper = {
    requests: [],
    scrape: null,
    probe: null,
    directory: null,
    down: false,
    binding: undefined as unknown as Fetcher,
  };
  const answer = async (path: string, body: unknown): Promise<unknown> => {
    if (path === "/v1/scrape" && fake.scrape) {
      return await fake.scrape(body as ScrapeRequest);
    }
    if (path === "/v1/probe" && fake.probe) {
      return fake.probe((body as { url: string }).url);
    }
    if (path === "/v1/directory" && fake.directory) {
      return fake.directory();
    }
    return undefined;
  };
  fake.binding = {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = new URL(requestUrl(input));
      const body = JSON.parse(String(init?.body ?? "null"));
      fake.requests.push({ path: url.pathname, body });
      if (fake.down) {
        throw new TypeError("fetch failed");
      }
      const result = await answer(url.pathname, body);
      if (result === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  } as unknown as Fetcher;
  return fake;
}

export interface ItemInput {
  company?: string;
  description?: string;
  location?: string;
  method?: CloudPostingItem["extraction"]["method"];
  ref?: string;
  title: string;
  url: string;
}

/** A valid scraped item (fingerprint and content hash as the scraper computes them). */
export async function cloudItem(
  domain: string,
  input: ItemInput,
  now: number
): Promise<CloudPostingItem> {
  const locations = input.location ? [{ raw: input.location }] : [];
  const description =
    input.description ?? `${input.title} — a remote role. `.repeat(4);
  return {
    client_ref: input.ref ?? input.url.slice(-30),
    fingerprint: await fingerprint({
      source_kind: "generic_listing",
      source_org: domain,
      source_job_ref: input.ref ?? null,
      title: input.title,
      company_domain: null,
      location_primary: primaryLocation(locations),
      apply_url: input.url,
      canonical_url: input.url,
    }),
    visibility: "public",
    source_kind: "generic_listing",
    source_org: domain,
    source_job_ref: input.ref ?? null,
    canonical_url: input.url,
    apply_url: input.url,
    company_name: input.company ?? "Acme Remote",
    title: input.title,
    locations,
    workplace_type: "remote",
    employment_type: "full_time",
    description_text: description,
    requirements: [],
    content_hash: await contentHash(input.title, description),
    observed_at: now,
    extraction: {
      v: 1,
      adapter: "generic_listing",
      adapter_version: "cloud-1",
      fetch_mode: "static_html",
      method: input.method ?? "rss",
      confidence: 0.85,
      observed_at: now,
    },
    extras: {
      skills: ["Go"],
      employment_detail: "full_time",
      application_method: "external_url",
      raw_metadata: { tags: ["go"] },
    },
  };
}

export function scrapeResponse(
  items: CloudPostingItem[],
  overrides: Partial<ScrapeResponse> = {}
): ScrapeResponse {
  return {
    v: 1,
    outcome: "ok",
    complete: true,
    items,
    ai_candidates: [],
    cursor_state: { v: 1 },
    stats: {
      pages: 1,
      postings_found: items.length,
      duplicates: 0,
      invalid: 0,
      relocated: 0,
      robots_skipped: 0,
      details_fetched: 0,
      elapsed_ms: 120,
      fetch_mode: "static_html",
    },
    error: null,
    warnings: [],
    log: [
      {
        at: 1,
        level: "info",
        event: "page_fetched",
        message: `1 page, ${items.length} items`,
      },
    ],
    engine: ENGINE,
    ...overrides,
  };
}
