// The merge planner without a database (20 §6.2, 03 §4.3).
import { describe, expect, it } from "bun:test";
import {
  contentHash,
  fingerprint,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { ExtractionProvenance } from "@pilihpendidikan/jobs-contracts/records";
import type { StoredPosting, UserJobLink } from "../../repo/discovery/postings";
import type { PreparedFullItem, PreparedUnchangedItem } from "./batch-items";
import { MAX_ALTERNATES, mergeProvenance, planBatch } from "./batch-plan";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const RUN = "run_01JA6V8M3W8Z1T6Q4Y2B7K9C0R";
const T0 = Date.UTC(2026, 9, 10);
const T1 = Date.UTC(2026, 9, 11);

function provenance(
  adapter: ExtractionProvenance["adapter"],
  listing?: string
): ExtractionProvenance {
  return {
    v: 1,
    adapter,
    adapter_version: "1.0.0",
    fetch_mode: "json_api",
    method: "json_api",
    confidence: 0.9,
    observed_at: T0,
    ...(listing ? { source_urls: { listing } } : {}),
  };
}

async function fullItem(
  over: Partial<PreparedFullItem> & { description?: string } = {}
): Promise<PreparedFullItem> {
  const title = "Backend Engineer";
  const description = over.description ?? "Build APIs.";
  return {
    kind: "full",
    index: 0,
    clientRef: "c1",
    fingerprint: await fingerprint({
      source_kind: "greenhouse",
      source_org: "acme",
      source_job_ref: "1",
      title,
    }),
    visibility: "public",
    sourceKind: "greenhouse",
    sourceOrg: "acme",
    sourceJobRef: "1",
    sourceId: null,
    observedAt: T1,
    statusHint: null,
    statusEvidence: null,
    content: {
      title,
      company_name: "Acme",
      company_domain: "acme.com",
      canonical_url: null,
      apply_url: "https://boards.greenhouse.io/acme/jobs/1",
      apply_domain: "greenhouse.io",
      department: null,
      locations: [{ raw: "Jakarta" }],
      workplace_type: null,
      employment_type: "full_time",
      seniority: null,
      salary: null,
      description_text: description,
      description_truncated: false,
      requirements: [],
      posted_at: null,
      application_support: "browser_supported",
    },
    contentHash: await contentHash(title, description),
    extraction: provenance(
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs"
    ),
    ...over,
  };
}

function stored(
  item: PreparedFullItem,
  over: Partial<StoredPosting> = {}
): StoredPosting {
  return {
    id: "pst_01JA6V8M3W8Z1T6Q4Y2B7K9C0P",
    fingerprint: item.fingerprint,
    visibility: "public",
    owner_user_id: null,
    source_kind: "greenhouse",
    source_org: "acme",
    source_job_ref: "1",
    canonical_url: null,
    apply_url: "https://boards.greenhouse.io/acme/jobs/1",
    apply_domain: "greenhouse.io",
    company_name: "Acme",
    company_domain: "acme.com",
    title: "Backend Engineer",
    department: "Platform",
    locations: [{ raw: "Jakarta" }],
    workplace_type: "hybrid",
    employment_type: "full_time",
    seniority: null,
    salary: { min: 1, max: 2, currency: "USD", period: "year" },
    description_truncated: false,
    requirements: ["Go"],
    content_hash: "0".repeat(64),
    dedupe_group: null,
    posted_at: null,
    first_seen_at: T0,
    last_seen_at: T0,
    last_checked_at: null,
    status: "open",
    closed_at: null,
    missed_runs: 1,
    extraction: provenance(
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs"
    ),
    application_support: "browser_supported",
    revision: 3,
    created_at: T0,
    updated_at: T0,
    ...over,
  };
}

let seq = 0;
const ids = (prefix: "pst" | "ujb") =>
  `${prefix}_01JA6V8M3W8Z1T6Q4Y2B7K9C${String(seq++).padStart(2, "0")}`;

function link(posting: StoredPosting, state = "new"): Map<string, UserJobLink> {
  return new Map([
    [
      posting.id,
      {
        id: "ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C0U",
        posting_id: posting.id,
        inbox_state: state,
        revision: 1,
      },
    ],
  ]);
}

describe("T20-09 merge planning", () => {
  it("T20-09 field-level merge keeps stored values the observation lacks, and guards the revision", async () => {
    const item = await fullItem({ description: "A new description." });
    const row = stored(item);
    const plan = await planBatch({
      items: [item],
      stored: new Map([[`public|${item.fingerprint}`, row]]),
      links: link(row),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan.results[0].outcome).toBe("updated");
    const [update] = plan.updates;
    expect(update.revisionBump).toBe(true);
    expect(update.content).toMatchObject({
      description_text: "A new description.",
      department: "Platform",
      workplace_type: "hybrid",
      salary: { min: 1, max: 2 },
    });
    expect(update.sightedAt).toBe(T1);
    expect(plan.guards).toEqual([{ id: row.id, revision: 3, lastSeenAt: T0 }]);
    expect(plan.fanout).toEqual([row.id]);
    expect(plan.runItems).toEqual([{ postingId: row.id, outcome: "updated" }]);
    expect(plan.scorePostingIds).toEqual([row.id]);
  });

  it("T20-09 a sighting alone writes last_seen/missed_runs without guard, revision or fan-out", async () => {
    const item = await fullItem();
    const row = stored(item, { content_hash: item.contentHash });
    const plan = await planBatch({
      items: [item],
      stored: new Map([[`public|${item.fingerprint}`, row]]),
      links: link(row, "dismissed"),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan.results[0].outcome).toBe("unchanged");
    expect(plan.updates[0]).toMatchObject({
      revisionBump: false,
      content: null,
      sightedAt: T1,
    });
    expect(plan.guards).toEqual([]);
    expect(plan.fanout).toEqual([]);
    expect(plan.newLinks).toEqual([]);
    expect(plan.scorePostingIds).toEqual([]);
  });

  it("T20-10 an existing dismissed link is never re-created or reset", async () => {
    const item = await fullItem({ description: "changed" });
    const row = stored(item);
    const plan = await planBatch({
      items: [item],
      stored: new Map([[`public|${item.fingerprint}`, row]]),
      links: link(row, "dismissed"),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan.newLinks).toEqual([]);
    // Content changed, but a dismissed job is not re-scored (07 §6).
    expect(plan.scorePostingIds).toEqual([]);
  });

  it("TD-UNCHANGED an unchanged item for an unlinked posting is invalid", async () => {
    const item = await fullItem();
    const row = stored(item);
    const unchanged: PreparedUnchangedItem = {
      kind: "unchanged",
      index: 0,
      clientRef: "u",
      fingerprint: item.fingerprint,
      observedAt: T1,
      statusHint: null,
      statusEvidence: null,
    };
    const plan = await planBatch({
      items: [unchanged],
      stored: new Map([[`public|${item.fingerprint}`, row]]),
      links: new Map(),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan.results[0]).toMatchObject({
      outcome: "invalid",
      errors: [{ code: "unknown_fingerprint" }],
    });
    expect(plan.updates).toEqual([]);
    expect(plan.runItems).toEqual([]);
  });

  it("TD-PRIVATE new private postings are owned by the caller; public ones have no owner", async () => {
    const pub = await fullItem();
    const priv = await fullItem({ visibility: "private", clientRef: "c2" });
    const plan = await planBatch({
      items: [pub, priv],
      stored: new Map(),
      links: new Map(),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan.inserts.map((i) => i.values.owner_user_id)).toEqual([
      null,
      USER,
    ]);
    expect(plan.inserts.map((i) => i.values.visibility)).toEqual([
      "public",
      "private",
    ]);
    expect(
      plan.newLinks.every(
        (l) =>
          l.origin === "discovered" &&
          l.inboxState === "new" &&
          l.firstRunId === RUN
      )
    ).toBe(true);
  });

  it("TD-CLOSE-HINT a closed hint after the last sighting closes; an older one does not", async () => {
    const item = await fullItem();
    const row = stored(item, { content_hash: item.contentHash });
    const closing: PreparedUnchangedItem = {
      kind: "unchanged",
      index: 0,
      clientRef: "u",
      fingerprint: item.fingerprint,
      observedAt: T1,
      statusHint: "closed",
      statusEvidence: { http_status: 410 },
    };
    const plan = await planBatch({
      items: [closing],
      stored: new Map([[`public|${item.fingerprint}`, row]]),
      links: link(row),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan.updates[0].status).toEqual({ status: "closed", closedAt: T1 });
    expect(plan.updates[0].sightedAt).toBeNull();
    const stale = { ...closing, observedAt: T0 - 1 };
    const plan2 = await planBatch({
      items: [stale],
      stored: new Map([[`public|${item.fingerprint}`, row]]),
      links: link(row),
      newId: ids,
      now: T1,
      runId: RUN,
      userId: USER,
    });
    expect(plan2.updates[0].status).toBeNull();
    expect(plan2.results[0].outcome).toBe("unchanged");
  });
});

describe("T20-09 provenance alternates (12 §4)", () => {
  it("T20-09 mergeProvenance keeps the primary, appends other adapters once and caps the list", () => {
    const primary = provenance("career_page", "https://acme.com/careers");
    expect(
      mergeProvenance(
        primary,
        provenance("career_page", "https://acme.com/careers")
      )
    ).toBeNull();
    const once = mergeProvenance(
      primary,
      provenance("custom_url", "https://acme.com/jobs/1")
    );
    expect(once?.adapter).toBe("career_page");
    expect(once?.alternates).toHaveLength(1);
    expect(
      mergeProvenance(
        once ?? {},
        provenance("custom_url", "https://acme.com/jobs/1")
      )
    ).toBeNull();
    let current: Record<string, unknown> = primary;
    for (let i = 0; i < 15; i++) {
      current =
        mergeProvenance(
          current,
          provenance("generic_listing", `https://acme.com/l/${i}`)
        ) ?? current;
    }
    expect((current.alternates as unknown[]).length).toBe(MAX_ALTERNATES);
    expect(mergeProvenance({}, primary)).toEqual({ ...primary });
  });
});
