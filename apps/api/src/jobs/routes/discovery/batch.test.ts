// postings:batch (05 §4, 20 §6.2 / §7, 15 §11 / §12, 07 §7.1).
import { beforeEach, describe, expect, it } from "bun:test";
import { PostingsBatchResponseSchema } from "@pilihpendidikan/jobs-contracts/api";
import vectors from "@pilihpendidikan/jobs-contracts/test-vectors/fingerprint.json" with {
  type: "json",
};
import { asciiHost } from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { DiscoveryFixture } from "./fixtures.test";
import {
  BOB,
  discoveryFixture,
  postingItem,
  postingRow,
  unchangedItem,
  userJobRows,
} from "./fixtures.test";

let f: DiscoveryFixture;
let run: string;

beforeEach(async () => {
  f = await discoveryFixture();
  run = await f.startRun(f.cli);
});

function changeRows(userId: string) {
  return f.t.jobsSqlite
    .query(
      "SELECT entity, entity_id, revision FROM change_log WHERE user_id = ? ORDER BY seq"
    )
    .all(userId) as { entity: string; entity_id: string; revision: number }[];
}

describe("postings:batch basics (05 §4)", () => {
  it("TD-BATCH new items create public postings, link the caller and record run items", async () => {
    const a = await postingItem({ ref: "1" });
    const b = await postingItem({ ref: "2", title: "Data Engineer" });
    const res = await f.batch(f.cli, run, [a, b]);
    expect(res.status).toBe(200);
    PostingsBatchResponseSchema.parse(res.body);
    expect(res.body.items.map((i) => i.outcome)).toEqual(["new", "new"]);
    const [first] = res.body.items;
    const row = postingRow(f.t, first.posting_id ?? "");
    expect(row).toMatchObject({
      visibility: "public",
      owner_user_id: null,
      status: "open",
      missed_runs: 0,
      revision: 1,
      first_seen_at: a.observed_at,
      last_seen_at: a.observed_at,
      apply_domain: "greenhouse.io",
    });
    const extraction = JSON.parse(row.extraction);
    expect(extraction.run_id).toBe(run);
    expect(extraction.device_id).toBe(f.cli.deviceId);
    const links = userJobRows(f.t, f.cli.userId ?? "");
    expect(links).toHaveLength(2);
    expect(
      links.every((l) => l.origin === "discovered" && l.inbox_state === "new")
    ).toBe(true);
    const items = f.t.jobsSqlite
      .query("SELECT outcome FROM discovery_run_items WHERE run_id = ?")
      .all(run) as { outcome: string }[];
    expect(items.map((i) => i.outcome)).toEqual(["new", "new"]);
    const entities = changeRows(f.cli.userId ?? "").map((r) => r.entity);
    expect(entities.filter((e) => e === "posting")).toHaveLength(2);
    expect(entities.filter((e) => e === "user_job")).toHaveLength(2);
  });

  it("TD-BATCH a web session or another device cannot upload to the run", async () => {
    const item = await postingItem();
    const web = await f.batch(f.web, run, [item]);
    expect(web.status).toBe(403);
    expect(web.body).toMatchObject({ error: "device_required" });
    const laptop2 = await f.client.cliSession("alice@example.com");
    const other = await f.batch(laptop2, run, [item]);
    expect(other.status).toBe(403);
    const bob = await f.client.cliSession(BOB);
    const foreign = await f.batch(bob, run, [item]);
    expect(foreign.status).toBe(404);
  });

  it("TD-BATCH an idempotent replay returns the stored response", async () => {
    const item = await postingItem();
    const first = await f.batch(f.cli, run, [item], { idempotencyKey: "b-1" });
    const again = await f.batch(f.cli, run, [item], { idempotencyKey: "b-1" });
    expect(again.status).toBe(200);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(userJobRows(f.t, f.cli.userId ?? "")).toHaveLength(1);
  });

  it("TD-BATCH a duplicate fingerprint inside one batch is one posting", async () => {
    const a = await postingItem({ ref: "7", client_ref: "x1" });
    const b = { ...a, client_ref: "x2" };
    const res = await f.batch(f.cli, run, [a, b]);
    expect(res.body.items.map((i) => i.outcome)).toEqual(["new", "unchanged"]);
    expect(res.body.items[0].posting_id).toBe(
      res.body.items[1].posting_id ?? ""
    );
    expect(userJobRows(f.t, f.cli.userId ?? "")).toHaveLength(1);
  });
});

describe("TD-BATCH-LIMITS item validation and batch limits", () => {
  it("TD-BATCH-LIMITS more than 100 items is 400", async () => {
    const item = await postingItem();
    const items = Array.from({ length: 101 }, (_, i) => ({
      ...item,
      client_ref: `c${i}`,
    }));
    const res = await f.batch(f.cli, run, items);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("TD-BATCH-LIMITS a body over 1 MB is 413", async () => {
    const item = await postingItem({ description: "x".repeat(60_000) });
    const items = Array.from({ length: 20 }, (_, i) => ({
      ...item,
      client_ref: `c${i}`,
    }));
    const res = await f.batch(f.cli, run, items);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: "payload_too_large" });
  });

  it("TD-BATCH-LIMITS NUL and control characters make the item invalid, not the batch", async () => {
    const good = await postingItem({ ref: "1" });
    const nul = await postingItem({ ref: "2", title: "Back\u0000end" });
    const ctl = await postingItem({
      ref: "3",
      description: "line\u0007bell and more text here",
    });
    const res = await f.batch(f.cli, run, [good, nul, ctl]);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.outcome)).toEqual([
      "new",
      "invalid",
      "invalid",
    ]);
    expect(res.body.items[1].errors?.[0]).toMatchObject({
      code: "schema_invalid",
      path: "title",
    });
    expect(res.body.items[1].posting_id).toBeUndefined();
  });

  it("TD-BATCH-LIMITS a deeply nested item is invalid, the batch still answers", async () => {
    const good = await postingItem({ ref: "1" });
    let deep: unknown = "x";
    for (let i = 0; i < 10_000; i++) {
      deep = [deep];
    }
    const bad = {
      ...(await postingItem({ ref: "2" })),
      extraction: { v: 1, nested: deep },
    };
    const res = await f.batch(f.cli, run, [good, bad]);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.outcome)).toEqual(["new", "invalid"]);
  });

  it("TD-BATCH-LIMITS schema failures are per item with the Zod path", async () => {
    const good = await postingItem({ ref: "1" });
    const { title: _title, ...noTitle } = await postingItem({ ref: "2" });
    const res = await f.batch(f.cli, run, [good, noTitle, 42]);
    expect(res.body.items.map((i) => i.outcome)).toEqual([
      "new",
      "invalid",
      "invalid",
    ]);
    expect(res.body.items[1].errors?.[0].code).toBe("schema_invalid");
    expect(res.body.items[2].client_ref).toBe("#2");
  });

  it("TD-BATCH-LIMITS descriptions are capped at 64 KB and flagged", async () => {
    const description = `${"é".repeat(40_000)} tail`;
    const item = await postingItem({ description });
    const res = await f.batch(f.cli, run, [item]);
    expect(res.body.items[0].outcome).toBe("new");
    const row = postingRow(f.t, res.body.items[0].posting_id ?? "");
    expect(
      new TextEncoder().encode(row.description_text as string).byteLength
    ).toBeLessThanOrEqual(65_536);
    expect(row.description_truncated).toBe(1);
  });

  it("TD-BATCH-LIMITS URLs must be http(s) without userinfo; ATS items need https", async () => {
    const js = await postingItem({
      ref: "1",
      apply_url: "javascript:alert(1)",
    });
    const userinfo = await postingItem({
      ref: "2",
      apply_url: "https://user:pw@boards.greenhouse.io/acme/jobs/2",
    });
    const http = await postingItem({
      ref: "3",
      apply_url: "http://boards.greenhouse.io/acme/jobs/3",
    });
    const res = await f.batch(f.cli, run, [js, userinfo, http]);
    expect(res.body.items.map((i) => i.outcome)).toEqual([
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(res.body.items[1].errors?.[0].message).toContain("user name");
  });

  it("TD-BATCH-LIMITS posted_at more than a day ahead and closed hints without evidence are invalid", async () => {
    const future = {
      ...(await postingItem({ ref: "1" })),
      posted_at: f.clock.now() + 3 * 86_400_000,
    };
    const closed = await postingItem({ ref: "2", status_hint: "closed" });
    const res = await f.batch(f.cli, run, [future, closed]);
    expect(res.body.items.map((i) => i.errors?.[0].path)).toEqual([
      "posted_at",
      "status_evidence",
    ]);
  });

  it("TD-BATCH-LIMITS LinkedIn / Indeed URLs are excluded_source (D-17)", async () => {
    const li = await postingItem({
      ref: "1",
      source_kind: "career_page",
      org: null,
      apply_url: "https://www.linkedin.com/jobs/view/1",
    });
    const indeed = await postingItem({
      ref: "2",
      source_kind: "custom_url",
      org: null,
      apply_url: "https://id.indeed.com/viewjob?jk=1",
    });
    const res = await f.batch(f.cli, run, [li, indeed]);
    expect(res.body.items.map((i) => i.errors?.[0].code)).toEqual([
      "excluded_source",
      "excluded_source",
    ]);
  });

  it("TD-BATCH-LIMITS observed_at far in the future is clamped to server time", async () => {
    const item = await postingItem({
      observed_at: f.clock.now() + 3 * 86_400_000,
    });
    const res = await f.batch(f.cli, run, [item]);
    const row = postingRow(f.t, res.body.items[0].posting_id ?? "");
    expect(row.last_seen_at).toBe(f.clock.now());
    expect(JSON.parse(row.extraction).flags).toContain("observed_at_clamped");
  });

  it("TD-BATCH-LIMITS a 100-item batch stays within the D1 statement and parameter limits", async () => {
    // Seed 50 existing postings with older content (updates + guards), and
    // send 50 new ones: the worst mix of inserts, updates and fan-out.
    const old = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        postingItem({
          ref: `o${i}`,
          description: `old description number ${i} with enough text`,
        })
      )
    );
    expect((await f.batch(f.cli, run, old)).status).toBe(200);
    const updated = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        postingItem({
          ref: `o${i}`,
          description: `new description number ${i} with enough text`,
          observed_at: f.clock.now(),
        })
      )
    );
    const fresh = await Promise.all(
      Array.from({ length: 50 }, (_, i) => postingItem({ ref: `n${i}` }))
    );
    const run2 = await f.startRun(f.cli);
    const d1 = f.t.env.JOBS_DB as unknown as {
      batch: (s: unknown[]) => Promise<unknown>;
      prepare: (sql: string) => unknown;
    };
    const originalBatch = d1.batch.bind(d1);
    const originalPrepare = d1.prepare.bind(d1);
    const sizes: { params: number[]; statements: number }[] = [];
    let prepared = 0;
    d1.batch = (statements: unknown[]) => {
      sizes.push({
        statements: statements.length,
        params: statements.map(
          (s) => (s as { params: unknown[] }).params.length
        ),
      });
      return originalBatch(statements);
    };
    d1.prepare = (sql: string) => {
      prepared++;
      return originalPrepare(sql);
    };
    const res = await f.batch(f.cli, run2, [...updated, ...fresh], {
      idempotencyKey: "big",
    });
    expect(res.status).toBe(200);
    expect(res.body.items.filter((i) => i.outcome === "updated")).toHaveLength(
      50
    );
    expect(res.body.items.filter((i) => i.outcome === "new")).toHaveLength(50);
    // The write batch: 50 guards + 100 posting writes + links, fan-out,
    // change rows, run items and the idempotency row (14 §4: ≤ 403).
    const main = sizes[0];
    expect(main.statements).toBeGreaterThan(150);
    expect(main.statements).toBeLessThanOrEqual(403);
    expect(Math.max(...sizes.flatMap((s) => s.params))).toBeLessThanOrEqual(
      100
    );
    // Every JOBS_DB query of the request (reads, writes, scoring) ≤ 1,000.
    expect(prepared).toBeLessThan(1000);
  });
});

describe("T20-11 server-side fingerprint recompute (20 §7 step 6)", () => {
  interface VectorCase {
    fingerprint: string;
    input: Record<string, string | null | undefined>;
    key: string;
    name: string;
  }
  const cases = (vectors as { cases: VectorCase[] }).cases;

  it("T20-11 every golden vector that forms a valid item is accepted with the vector's fingerprint", async () => {
    const refused: string[] = [];
    let index = 0;
    for (const vector of cases) {
      const input = vector.input;
      // What the CLI normalizer sends (15 §10.1): company_domain as an ASCII
      // host; src| keys ignore URLs, so those items get an apply_url.
      const srcKey = vector.key.startsWith("src|");
      const item = await postingItem({
        source_kind: input.source_kind as never,
        org: input.source_org ?? null,
        ref: input.source_job_ref ?? null,
        title: input.title ?? "",
        company_domain: asciiHost(input.company_domain),
        location: input.location_primary ?? null,
        apply_url:
          input.apply_url ??
          (srcKey ? "https://jobs.example.com/apply/1" : null),
        canonical_url: input.canonical_url ?? null,
        client_ref: `v${index++}`,
        visibility: ["manual", "email"].includes(input.source_kind ?? "")
          ? "private"
          : "public",
      });
      expect(item.fingerprint).toBe(vector.fingerprint);
      const res = await f.batch(f.cli, run, [item]);
      const [result] = res.body.items;
      if (result.outcome === "invalid") {
        refused.push(vector.name);
        // Refused only for not being a valid item, never for drift.
        expect(result.errors?.map((e) => e.code)).toEqual(["schema_invalid"]);
      } else {
        expect(postingRow(f.t, result.posting_id ?? "").fingerprint).toBe(
          vector.fingerprint
        );
      }
    }
    // Only the inputs without an http(s) URL (15 §10.2) are not items.
    expect(refused).toEqual([
      "manual posting with no host or url",
      "mailto apply_url contributes no url",
    ]);
  });

  it("T20-11 a client fingerprint that differs from the server's is invalid (fingerprint_mismatch)", async () => {
    const item = await postingItem();
    const drifted = { ...item, fingerprint: cases[1].fingerprint };
    const res = await f.batch(f.cli, run, [drifted]);
    expect(res.body.items[0]).toMatchObject({ outcome: "invalid" });
    expect(res.body.items[0].errors?.[0].code).toBe("fingerprint_mismatch");
    expect(res.body.items[0].posting_id).toBeUndefined();
  });

  it("T20-11 stored content_hash and dedupe_group are the server's (golden vectors)", async () => {
    const hashCase = (
      vectors as unknown as {
        content_hash: {
          content_hash: string;
          description: string;
          title: string;
        }[];
      }
    ).content_hash[0];
    const groupCase = (
      vectors as unknown as {
        dedupe_group: {
          dedupe_group: string;
          input: {
            company_domain: string;
            location_primary: string;
            title: string;
          };
        }[];
      }
    ).dedupe_group[0];
    const item = await postingItem({
      title: groupCase.input.title,
      company_domain: "acme.com",
      location: groupCase.input.location_primary,
    });
    const res = await f.batch(f.cli, run, [
      { ...item, dedupe_group: "0".repeat(64) },
    ]);
    const row = postingRow(f.t, res.body.items[0].posting_id ?? "");
    expect(row.dedupe_group).toBe(groupCase.dedupe_group);
    const hashed = await postingItem({
      ref: "h1",
      title: hashCase.title,
      description: hashCase.description,
    });
    const res2 = await f.batch(f.cli, run, [
      { ...hashed, content_hash: "f".repeat(64) },
    ]);
    expect(
      postingRow(f.t, res2.body.items[0].posting_id ?? "").content_hash
    ).toBe(hashCase.content_hash);
  });
});

describe("T20-09 posting merge (20 §6.2, §6.3 D)", () => {
  it("T20-09 an older observed_at with a different content_hash changes no field; last_seen_at = max", async () => {
    const today = await postingItem({
      title: "Backend Engineer",
      description: "Current description, the newest one we have.",
      observed_at: Date.UTC(2026, 9, 11, 9),
    });
    const first = await f.batch(f.cli, run, [today]);
    const id = first.body.items[0].posting_id ?? "";
    const stale = await postingItem({
      title: "Backend Engineer",
      description: "Yesterday's description from an offline run.",
      observed_at: Date.UTC(2026, 9, 10, 9),
    });
    const res = await f.batch(f.cli, run, [stale]);
    expect(res.body.items[0].outcome).toBe("unchanged");
    const row = postingRow(f.t, id);
    expect(row.description_text).toBe(
      "Current description, the newest one we have."
    );
    expect(row.content_hash).toBe(today.content_hash);
    expect(row.last_seen_at).toBe(Date.UTC(2026, 9, 11, 9));
    expect(row.revision).toBe(1);
  });

  it("T20-09 a newer observation with new content updates fields, bumps revision and keeps first_seen_at + provenance", async () => {
    const v1 = await postingItem({
      salary: { min: 10, max: 20, currency: "USD", period: "year" },
      observed_at: Date.UTC(2026, 9, 10),
    });
    const first = await f.batch(f.cli, run, [v1]);
    const id = first.body.items[0].posting_id ?? "";
    const bob = await f.client.cliSession(BOB);
    const bobRun = await f.startRun(bob);
    await f.batch(bob, bobRun, [v1]);
    const v2 = await postingItem({
      description: "Rewritten: now with Rust and Kubernetes, more text.",
      observed_at: Date.UTC(2026, 9, 11),
    });
    const res = await f.batch(f.cli, run, [
      { ...v2, extraction: { ...v2.extraction, adapter_version: "9.9.9" } },
    ]);
    expect(res.body.items[0].outcome).toBe("updated");
    const row = postingRow(f.t, id);
    expect(row.description_text).toContain("Rust");
    expect(row.revision).toBe(2);
    expect(row.first_seen_at).toBe(Date.UTC(2026, 9, 10));
    expect(JSON.parse(row.salary as string)).toMatchObject({
      min: 10,
      max: 20,
    });
    expect(JSON.parse(row.extraction).adapter_version).toBe("1.0.0");
    // The shared posting's change reaches every linked user's feed.
    const bobChanges = changeRows(bob.userId ?? "").filter(
      (r) => r.entity === "posting" && r.entity_id === id
    );
    expect(bobChanges.map((r) => r.revision)).toEqual([1, 2]);
  });

  it("T20-09 another adapter producing the same fingerprint is recorded in extraction.alternates", async () => {
    const item = await postingItem({
      source_kind: "career_page",
      org: null,
      ref: null,
      apply_url: "https://careers.acme.com/jobs/5",
    });
    const first = await f.batch(f.cli, run, [item]);
    const id = first.body.items[0].posting_id ?? "";
    const other = {
      ...item,
      extraction: {
        ...item.extraction,
        adapter: "custom_url" as const,
        source_urls: { listing: "https://careers.acme.com/jobs/5" },
      },
    };
    await f.batch(f.cli, run, [other]);
    const extraction = JSON.parse(postingRow(f.t, id).extraction);
    expect(extraction.adapter).toBe("career_page");
    expect(extraction.alternates).toHaveLength(1);
    expect(extraction.alternates[0].adapter).toBe("custom_url");
  });

  it("T20-09 server-managed provenance keys from the client are dropped", async () => {
    const item = await postingItem();
    const res = await f.batch(f.cli, run, [
      {
        ...item,
        extraction: {
          ...item.extraction,
          alternates: [{ adapter: "lever" }],
          run_id: newId("run"),
        },
      },
    ]);
    const extraction = JSON.parse(
      postingRow(f.t, res.body.items[0].posting_id ?? "").extraction
    );
    expect(extraction.alternates).toBeUndefined();
    expect(extraction.run_id).toBe(run);
  });
});

describe("T20-10 discovery never downgrades inbox_state (20 §6.2, §6.3 C)", () => {
  it("T20-10 a re-run keeps dismissed and tracked links, bumps last_seen_at, outcome unchanged", async () => {
    const a = await postingItem({ ref: "1" });
    const b = await postingItem({ ref: "2" });
    const first = await f.batch(f.cli, run, [a, b]);
    const [ua, ub] = first.body.items.map((i) => i.user_job_id ?? "");
    f.t.jobsSqlite
      .query("UPDATE user_jobs SET inbox_state = 'dismissed' WHERE id = ?")
      .run(ua);
    f.t.jobsSqlite
      .query("UPDATE user_jobs SET inbox_state = 'tracked' WHERE id = ?")
      .run(ub);
    const later = f.clock.now();
    const run2 = await f.startRun(f.cli);
    const res = await f.batch(f.cli, run2, [
      { ...a, observed_at: later },
      unchangedItem(b, { observed_at: later }),
    ]);
    expect(res.body.items.map((i) => i.outcome)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    const states = Object.fromEntries(
      userJobRows(f.t, f.cli.userId ?? "").map((u) => [u.id, u.inbox_state])
    );
    expect(states).toEqual({ [ua]: "dismissed", [ub]: "tracked" });
    expect(
      postingRow(f.t, first.body.items[0].posting_id ?? "").last_seen_at
    ).toBe(later);
  });
});

describe("T7-06 producer idempotency (07 §7.1)", () => {
  it("T7-06 a duplicate postings batch does not send a second score message", async () => {
    const items = await Promise.all([
      postingItem({ ref: "1" }),
      postingItem({ ref: "2" }),
    ]);
    await f.batch(f.cli, run, items, { idempotencyKey: "k-1" });
    expect(f.t.queue.sent).toHaveLength(1);
    expect(f.t.queue.sent[0].body).toMatchObject({
      type: "score_postings",
      user_id: f.cli.userId,
    });
    expect(
      (f.t.queue.sent[0].body as { posting_ids: string[] }).posting_ids
    ).toHaveLength(2);
    await f.batch(f.cli, run, items, { idempotencyKey: "k-2" });
    await f.batch(f.cli, run, items);
    expect(f.t.queue.sent).toHaveLength(1);
    const queued = f.t.jobsSqlite
      .query(
        "SELECT count(*) AS n FROM match_scores WHERE user_id = ? AND status = 'queued'"
      )
      .get(f.cli.userId) as { n: number };
    expect(queued.n).toBe(2);
  });
});

describe("TD-UNCHANGED unchanged-only items (20 §7 step 2, 15 §9)", () => {
  it("TD-UNCHANGED an unchanged item bumps last_seen_at only and is recorded for the run", async () => {
    const item = await postingItem();
    const first = await f.batch(f.cli, run, [item]);
    const id = first.body.items[0].posting_id ?? "";
    const run2 = await f.startRun(f.cli);
    const seenAt = f.clock.now();
    const res = await f.batch(f.cli, run2, [
      unchangedItem(item, { observed_at: seenAt }),
    ]);
    expect(res.body.items[0]).toEqual({
      client_ref: item.client_ref,
      outcome: "unchanged",
      posting_id: id,
      user_job_id: first.body.items[0].user_job_id,
    });
    const row = postingRow(f.t, id);
    expect(row.last_seen_at).toBe(seenAt);
    expect(row.revision).toBe(1);
    const recorded = f.t.jobsSqlite
      .query(
        "SELECT outcome FROM discovery_run_items WHERE run_id = ? AND posting_id = ?"
      )
      .get(run2, id) as { outcome: string };
    expect(recorded.outcome).toBe("unchanged");
  });

  it("TD-UNCHANGED an unknown or unlinked fingerprint is invalid (unknown_fingerprint), never linked", async () => {
    const item = await postingItem({ ref: "55" });
    const res = await f.batch(f.cli, run, [unchangedItem(item)]);
    expect(res.body.items[0]).toMatchObject({ outcome: "invalid" });
    expect(res.body.items[0].errors?.[0].code).toBe("unknown_fingerprint");
    // Bob discovers it; Alice's unchanged item still does not link her.
    const bob = await f.client.cliSession(BOB);
    const bobRun = await f.startRun(bob);
    await f.batch(bob, bobRun, [item]);
    const again = await f.batch(f.cli, run, [unchangedItem(item)]);
    expect(again.body.items[0].outcome).toBe("invalid");
    expect(again.body.items[0].posting_id).toBeUndefined();
    expect(userJobRows(f.t, f.cli.userId ?? "")).toHaveLength(0);
  });

  it("TD-UNCHANGED an unchanged item with extra keys is validated as a full item", async () => {
    const item = await postingItem();
    const res = await f.batch(f.cli, run, [
      unchangedItem(item, { title: "x" }),
    ]);
    expect(res.body.items[0].outcome).toBe("invalid");
    expect(res.body.items[0].errors?.[0].code).toBe("schema_invalid");
  });
});

describe("TD-PRIVATE visibility and isolation (03 §4.1, 11 §6.1 rule 4)", () => {
  it("TD-PRIVATE private postings are per owner; the same fingerprint stays separate per user", async () => {
    const item = await postingItem({
      visibility: "private",
      source_kind: "custom_url",
      org: null,
      ref: null,
      apply_url: "https://jobs.example.com/apply/1",
    });
    const mine = await f.batch(f.cli, run, [item]);
    const bob = await f.client.cliSession(BOB);
    const bobRun = await f.startRun(bob);
    const theirs = await f.batch(bob, bobRun, [item]);
    expect(mine.body.items[0].outcome).toBe("new");
    expect(theirs.body.items[0].outcome).toBe("new");
    expect(theirs.body.items[0].posting_id).not.toBe(
      mine.body.items[0].posting_id ?? ""
    );
    const rows = f.t.jobsSqlite
      .query(
        "SELECT owner_user_id FROM job_postings WHERE fingerprint = ? ORDER BY rowid"
      )
      .all(item.fingerprint) as { owner_user_id: string }[];
    expect(rows.map((r) => r.owner_user_id)).toEqual([
      f.cli.userId ?? "",
      bob.userId ?? "",
    ]);
  });

  it("TD-PRIVATE public postings are shared by fingerprint; each user gets their own link", async () => {
    const item = await postingItem();
    const mine = await f.batch(f.cli, run, [item]);
    const bob = await f.client.cliSession(BOB);
    const bobRun = await f.startRun(bob);
    const theirs = await f.batch(bob, bobRun, [item]);
    expect(theirs.body.items[0].outcome).toBe("new");
    expect(theirs.body.items[0].posting_id).toBe(
      mine.body.items[0].posting_id ?? ""
    );
    expect(theirs.body.items[0].user_job_id).not.toBe(
      mine.body.items[0].user_job_id ?? ""
    );
    const count = f.t.jobsSqlite
      .query("SELECT count(*) AS n FROM job_postings")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("TD-PRIVATE manual / email postings and private sources cannot be public (private_conflict)", async () => {
    const manual = await postingItem({
      ref: null,
      org: null,
      source_kind: "manual",
      apply_url: "https://acme.com/jobs/1",
    });
    const src = await f.source(f.cli, { board_token: "acme" });
    f.t.jobsSqlite
      .query(
        "UPDATE job_sources SET adapter = 'custom_url', config = ? WHERE id = ?"
      )
      .run(
        JSON.stringify({ url: "https://acme.com/jobs/2", private: true }),
        src
      );
    const privateSource = await postingItem({
      ref: null,
      org: null,
      source_kind: "custom_url",
      apply_url: "https://acme.com/jobs/2",
      source_id: src,
    });
    const res = await f.batch(f.cli, run, [manual, privateSource]);
    expect(res.body.items.map((i) => i.errors?.[0].code)).toEqual([
      "private_conflict",
      "private_conflict",
    ]);
  });

  it("TD-PRIVATE invalid items never return a posting id, even for an existing posting", async () => {
    const item = await postingItem();
    const bob = await f.client.cliSession(BOB);
    const bobRun = await f.startRun(bob);
    await f.batch(bob, bobRun, [item]);
    const res = await f.batch(f.cli, run, [
      { ...item, fingerprint: `fp1:${"a".repeat(64)}` },
      unchangedItem(item),
    ]);
    expect(
      res.body.items.every(
        (i) => i.posting_id === undefined && i.user_job_id === undefined
      )
    ).toBe(true);
  });

  it("TD-PRIVATE a foreign source_id is ignored (not linked)", async () => {
    const bob = await f.client.cliSession(BOB);
    const bobSource = await f.source(bob);
    const item = await postingItem({ source_id: bobSource });
    const res = await f.batch(f.cli, run, [item]);
    expect(res.body.items[0].outcome).toBe("new");
    expect(userJobRows(f.t, f.cli.userId ?? "")[0].source_id).toBeNull();
  });
});

describe("TD-DEDUPE cross-source duplicates (15 §11)", () => {
  it("TD-DEDUPE dedupe_group is computed server-side from company domain, title and primary location", async () => {
    const ats = await postingItem({
      ref: "9",
      title: "Senior Data Engineer",
      location: "Jakarta",
    });
    const page = await postingItem({
      source_kind: "career_page",
      org: null,
      ref: null,
      title: "Senior  Data Engineer",
      location: "Jakarta",
      apply_url: "https://careers.acme.com/jobs/9",
    });
    const res = await f.batch(f.cli, run, [ats, page]);
    const [a, b] = res.body.items.map((i) =>
      postingRow(f.t, i.posting_id ?? "")
    );
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.dedupe_group).toBeString();
    expect(a.dedupe_group).toBe(b.dedupe_group);
    const nodomain = await postingItem({ ref: "10", company_domain: null });
    const res2 = await f.batch(f.cli, run, [nodomain]);
    expect(
      postingRow(f.t, res2.body.items[0].posting_id ?? "").dedupe_group
    ).toBeNull();
  });
});

describe("TD-CLOSE-HINT status hints with evidence (15 §12)", () => {
  it("TD-CLOSE-HINT a closed hint closes the posting with evidence; a later sighting reopens it", async () => {
    const item = await postingItem({ observed_at: Date.UTC(2026, 9, 10) });
    const first = await f.batch(f.cli, run, [item]);
    const id = first.body.items[0].posting_id ?? "";
    const checkedAt = Date.UTC(2026, 9, 11);
    const res = await f.batch(f.cli, run, [
      unchangedItem(item, {
        observed_at: checkedAt,
        status_hint: "closed",
        status_evidence: { http_status: 404 },
      }),
    ]);
    expect(res.body.items[0].outcome).toBe("updated");
    let row = postingRow(f.t, id);
    expect(row).toMatchObject({
      status: "closed",
      closed_at: checkedAt,
      last_checked_at: checkedAt,
      revision: 2,
    });
    expect(JSON.parse(row.extraction).status_check).toMatchObject({
      status: "closed",
      http_status: 404,
    });
    const seen = f.clock.now();
    const reopen = await f.batch(f.cli, run, [
      unchangedItem(item, { observed_at: seen }),
    ]);
    expect(reopen.body.items[0].outcome).toBe("updated");
    row = postingRow(f.t, id);
    expect(row).toMatchObject({
      status: "open",
      closed_at: null,
      last_seen_at: seen,
      revision: 3,
    });
  });

  it("TD-CLOSE-HINT a closed hint older than the last sighting is ignored", async () => {
    const item = await postingItem({ observed_at: Date.UTC(2026, 9, 11) });
    const first = await f.batch(f.cli, run, [item]);
    const id = first.body.items[0].posting_id ?? "";
    const res = await f.batch(f.cli, run, [
      unchangedItem(item, {
        observed_at: Date.UTC(2026, 9, 10),
        status_hint: "closed",
        status_evidence: { marker: "no longer accepting applications" },
      }),
    ]);
    expect(res.body.items[0].outcome).toBe("unchanged");
    expect(postingRow(f.t, id).status).toBe("open");
  });

  it("TD-CLOSE-HINT an open hint records last_checked_at without a revision bump", async () => {
    const item = await postingItem({ observed_at: Date.UTC(2026, 9, 10) });
    const first = await f.batch(f.cli, run, [item]);
    const id = first.body.items[0].posting_id ?? "";
    const checkedAt = Date.UTC(2026, 9, 11);
    const res = await f.batch(f.cli, run, [
      unchangedItem(item, {
        observed_at: checkedAt,
        status_hint: "open",
        status_evidence: { http_status: 200 },
      }),
    ]);
    expect(res.body.items[0].outcome).toBe("unchanged");
    expect(postingRow(f.t, id)).toMatchObject({
      status: "open",
      last_checked_at: checkedAt,
      revision: 1,
    });
  });
});

describe("TD-PRIVATE concurrent writers re-plan instead of failing (20 §6.2)", () => {
  /** Runs `sideEffect` right before the first write batch of the next call. */
  function beforeFirstBatch(sideEffect: () => void): void {
    const d1 = f.t.env.JOBS_DB as unknown as {
      batch: (statements: unknown[]) => Promise<unknown>;
    };
    const original = d1.batch.bind(d1);
    let fired = false;
    d1.batch = (statements: unknown[]) => {
      if (!fired) {
        fired = true;
        sideEffect();
      }
      return original(statements);
    };
  }

  it("TD-PRIVATE another user inserting the same public fingerprint first links the existing row", async () => {
    const item = await postingItem({ ref: "race" });
    const winner = newId("pst", f.clock.now());
    beforeFirstBatch(() => {
      f.t.jobsSqlite
        .query(
          "INSERT INTO job_postings (id, fingerprint, visibility, source_kind, source_org, source_job_ref, company_name, title, content_hash, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, 'public', 'greenhouse', 'acme', 'race', 'Acme', 'Backend Engineer', ?, ?, ?, ?, ?)"
        )
        .run(
          winner,
          item.fingerprint,
          item.content_hash,
          item.observed_at,
          item.observed_at,
          item.observed_at,
          item.observed_at
        );
    });
    const res = await f.batch(f.cli, run, [item]);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      outcome: "new",
      posting_id: winner,
    });
    const count = f.t.jobsSqlite
      .query("SELECT count(*) AS n FROM job_postings")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("TD-PRIVATE a concurrent newer observation makes this one stale on re-plan (guard)", async () => {
    const v1 = await postingItem({ observed_at: Date.UTC(2026, 9, 10) });
    const first = await f.batch(f.cli, run, [v1]);
    const id = first.body.items[0].posting_id ?? "";
    const mine = await postingItem({
      description: "My update observed at 11 Oct, long enough.",
      observed_at: Date.UTC(2026, 9, 11),
    });
    beforeFirstBatch(() => {
      f.t.jobsSqlite
        .query(
          "UPDATE job_postings SET description_text = 'Concurrent newer content', content_hash = ?, revision = revision + 1, last_seen_at = ? WHERE id = ?"
        )
        .run("c".repeat(64), Date.UTC(2026, 9, 11, 12), id);
    });
    const res = await f.batch(f.cli, run, [mine]);
    expect(res.status).toBe(200);
    expect(res.body.items[0].outcome).toBe("unchanged");
    expect(postingRow(f.t, id)).toMatchObject({
      description_text: "Concurrent newer content",
      revision: 2,
      last_seen_at: Date.UTC(2026, 9, 11, 12),
    });
  });
});
