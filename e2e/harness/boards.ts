// Fixture job-board APIs for discovery (13 §4.1): the Greenhouse, Lever and
// Ashby responses recorded for the CLI's adapter tests
// (apps/jobs-cli/tests/fixtures/discovery), served on one loopback port. The
// CLI reaches it through `PILIH_JOBS_ENV=test` + `PILIH_JOBS_TEST_BASE_URLS`.
// Postings can be removed between runs (S-07) and every request is counted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";
import { serve } from "bun";
import { CLI_DIR } from "./env";

const FIXTURES = join(CLI_DIR, "tests/fixtures/discovery");

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export interface BoardPosting {
  kind: "greenhouse" | "lever" | "ashby";
  org: string;
  ref: string;
  title: string;
}

export const GREENHOUSE_BOARD = "acme";
export const LEVER_SITE = "acme";
export const ASHBY_BOARD = "ramp-id";

export class BoardServer {
  private readonly server: Server<undefined>;
  readonly removed = new Set<string>();
  readonly requests: string[] = [];
  private readonly greenhouse = fixture<{
    jobs: Array<{ id: number; title: string }>;
    meta: unknown;
  }>("greenhouse/board.json");
  private readonly lever = [
    ...fixture<Array<{ id: string; text: string }>>("lever/page1.json"),
    ...fixture<Array<{ id: string; text: string }>>("lever/page2.json"),
  ];
  private readonly ashby = fixture<{
    apiVersion: string;
    jobs: Array<{ id: string; title: string; isListed?: boolean }>;
  }>("ashby/board.json");

  constructor() {
    this.server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => this.handle(new URL(req.url)),
    });
  }

  get base(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  /** `PILIH_JOBS_TEST_BASE_URLS` for the three adapters. */
  get env(): Record<string, string> {
    return {
      PILIH_JOBS_ENV: "test",
      PILIH_JOBS_TEST_BASE_URLS: JSON.stringify({
        greenhouse: this.base,
        lever: this.base,
        ashby: this.base,
      }),
    };
  }

  /** The postings a complete discovery should find (listed, not removed). */
  postings(): BoardPosting[] {
    return [
      ...this.greenhouse.jobs.map((j) => ({
        kind: "greenhouse" as const,
        org: GREENHOUSE_BOARD,
        ref: String(j.id),
        title: j.title,
      })),
      ...this.lever.map((j) => ({
        kind: "lever" as const,
        org: LEVER_SITE,
        ref: j.id,
        title: j.text,
      })),
      ...this.ashby.jobs
        .filter((j) => j.isListed !== false)
        .map((j) => ({
          kind: "ashby" as const,
          org: ASHBY_BOARD,
          ref: j.id,
          title: j.title,
        })),
    ].filter((p) => !this.removed.has(p.ref));
  }

  private json(data: unknown): Response {
    return Response.json(data);
  }

  private handle(url: URL): Response {
    this.requests.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.pathname === `/v1/boards/${GREENHOUSE_BOARD}/jobs`) {
      return this.json({
        ...this.greenhouse,
        jobs: this.greenhouse.jobs.filter(
          (j) => !this.removed.has(String(j.id))
        ),
      });
    }
    const ghDetail = new RegExp(
      `^/v1/boards/${GREENHOUSE_BOARD}/jobs/(\\d+)$`
    ).exec(url.pathname);
    if (ghDetail) {
      const job = this.greenhouse.jobs.find(
        (j) => String(j.id) === ghDetail[1]
      );
      return job && !this.removed.has(String(job.id))
        ? this.json(job)
        : new Response("not found", { status: 404 });
    }
    if (url.pathname === `/v0/postings/${LEVER_SITE}`) {
      const skip = Number(url.searchParams.get("skip") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const live = this.lever.filter((j) => !this.removed.has(j.id));
      return this.json(live.slice(skip, skip + limit));
    }
    const leverDetail = new RegExp(
      `^/v0/postings/${LEVER_SITE}/([\\w-]+)$`
    ).exec(url.pathname);
    if (leverDetail) {
      const job = this.lever.find((j) => j.id === leverDetail[1]);
      return job && !this.removed.has(job.id)
        ? this.json(job)
        : new Response("not found", { status: 404 });
    }
    if (url.pathname === `/posting-api/job-board/${ASHBY_BOARD}`) {
      return this.json({
        ...this.ashby,
        jobs: this.ashby.jobs.filter((j) => !this.removed.has(j.id)),
      });
    }
    return new Response("not found", { status: 404 });
  }

  stop(): void {
    this.server.stop(true);
  }
}
