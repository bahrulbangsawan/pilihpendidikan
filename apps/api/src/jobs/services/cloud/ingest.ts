// Cloud ingestion (24 §6.5): scraped items → shared public postings.
//
//   1. each item is validated on its own (`CloudPostingItemSchema`), forced
//      public, its `observed_at` set to the server's clock and its
//      `source_id` cleared (cloud links carry the csr_ id instead);
//   2. duplicates inside the run keep the first occurrence;
//   3. `prepareItem` (the postings:batch validator) recomputes fingerprint,
//      content hash and dedupe group and refuses excluded hosts;
//   4. chunks of 50 are planned with the postings:batch merge rules in system
//      mode (`userId: null`) and written in one transactional batch each:
//      guards, inserts, content updates, one bulk sighting statement per 90
//      unchanged postings, the cloud columns of new/changed postings and the
//      change feed of every user linked to a changed posting.
//
// The fingerprint is the `gen|` key (domain, title, location, canonical URL),
// so two vacancies with the same title and employer but different URLs stay
// apart; copies of one vacancy on two boards share a `dedupe_group` (D-41).

import type {
  CloudPostingExtras,
  CloudPostingItem,
} from "@pilihpendidikan/jobs-contracts/cloud";
import { CloudPostingItemSchema } from "@pilihpendidikan/jobs-contracts/cloud";
import type { CloudWarning } from "@pilihpendidikan/jobs-contracts/cloud-config";
import { CLOUD_WARNINGS_MAX } from "@pilihpendidikan/jobs-contracts/cloud-config";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { CloudSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { JobsDb } from "../../repo/core/db";
import { retryOnGuardFailure } from "../../repo/core/db";
import {
  bulkSightingStatements,
  cloudColumnsStatement,
  postingGuardStatement,
  runCloudBatch,
} from "../../repo/cloud/postings";
import {
  findPublicPostingsByFingerprint,
  insertPostingStatement,
  postingFanoutStatements,
  updatePostingStatement,
} from "../../repo/discovery/postings";
import { chunk } from "../../repo/discovery/sql";
import type { InvalidItem, PreparedFullItem } from "../discovery/batch-items";
import { prepareItem } from "../discovery/batch-items";
import { planBatch } from "../discovery/batch-plan";

/** Items per planned batch (≤ ~110 statements, well inside D1's limits). */
export const INGEST_CHUNK = 50;

export interface IngestResult {
  confidenceAvg: number | null;
  duplicates: number;
  found: number;
  invalid: number;
  new: number;
  /** Postings this run inserted (fan-out to followers). */
  newPostingIds: string[];
  unchanged: number;
  updated: number;
  warnings: CloudWarning[];
}

interface Candidate {
  extras: CloudPostingExtras;
  prepared: PreparedFullItem;
}

function warningFor(item: InvalidItem): CloudWarning {
  const first = item.errors[0];
  return {
    code: "invalid_item",
    message:
      `${first?.code ?? "schema_invalid"}: ${first?.message ?? "invalid"}`.slice(
        0,
        500
      ),
    ...(first?.path ? { field: first.path.slice(0, 64) } : {}),
    count: 1,
  };
}

/** Merges warnings with the same code + field into one counted entry. */
export function mergeWarnings(
  warnings: readonly CloudWarning[]
): CloudWarning[] {
  const byKey = new Map<string, CloudWarning>();
  for (const warning of warnings) {
    const key = `${warning.code}|${warning.field ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + (warning.count ?? 1);
    } else {
      byKey.set(key, { ...warning, count: warning.count ?? 1 });
    }
  }
  return [...byKey.values()].slice(0, CLOUD_WARNINGS_MAX);
}

function normalizedRaw(
  item: CloudPostingItem,
  index: number,
  now: number
): Record<string, unknown> {
  const { extras: _extras, ...posting } = item;
  return {
    ...posting,
    client_ref: `c${index}`,
    visibility: "public",
    source_id: null,
    observed_at: now,
  };
}

async function prepareAll(
  items: readonly unknown[],
  source: CloudSourceRecord,
  runId: string,
  now: number,
  result: IngestResult
): Promise<Candidate[]> {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const warnings: CloudWarning[] = [];
  for (const [index, raw] of items.entries()) {
    const parsed = CloudPostingItemSchema.safeParse(raw);
    if (!parsed.success) {
      result.invalid += 1;
      const issue = parsed.error.issues[0];
      warnings.push({
        code: "invalid_item",
        message: `schema_invalid: ${issue?.message ?? "invalid"}`.slice(0, 500),
        ...(issue ? { field: issue.path.join(".").slice(0, 64) } : {}),
        count: 1,
      });
      continue;
    }
    const prepared = await prepareItem(
      normalizedRaw(parsed.data, index, now),
      index,
      { deviceId: null, now, ownedSources: new Map(), runId: null }
    );
    if (prepared.kind === "invalid") {
      result.invalid += 1;
      warnings.push(warningFor(prepared));
      continue;
    }
    if (prepared.kind !== "full") {
      result.invalid += 1;
      continue;
    }
    if (seen.has(prepared.fingerprint)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(prepared.fingerprint);
    prepared.extraction = {
      ...prepared.extraction,
      cloud: { source_id: source.id, run_id: runId, strategy: source.strategy },
    } as PreparedFullItem["extraction"];
    out.push({ prepared, extras: parsed.data.extras ?? {} });
  }
  result.warnings.push(...warnings);
  return out;
}

type Plan = Awaited<ReturnType<typeof planBatch>>;
type Stored = Awaited<ReturnType<typeof findPublicPostingsByFingerprint>>;

function isPureSighting(update: Plan["updates"][number]): boolean {
  return (
    update.content === null &&
    update.extraction === null &&
    update.status === null &&
    update.lastCheckedAt === null &&
    !update.revisionBump
  );
}

/** Cloud columns for the postings this chunk inserted or changed. */
function cloudColumnStatements(
  db: JobsDb,
  source: CloudSourceRecord,
  candidates: readonly Candidate[],
  stored: Stored,
  plan: Plan
): D1PreparedStatement[] {
  const extrasByFingerprint = new Map(
    candidates.map((c) => [c.prepared.fingerprint, c.extras])
  );
  const fingerprintOf = new Map<string, string>();
  for (const posting of stored.values()) {
    fingerprintOf.set(posting.id, posting.fingerprint);
  }
  const touched = new Set<string>();
  for (const insert of plan.inserts) {
    fingerprintOf.set(insert.id, insert.values.fingerprint);
    touched.add(insert.id);
  }
  for (const update of plan.updates) {
    if (update.content) {
      touched.add(update.id);
    }
  }
  const statements: D1PreparedStatement[] = [];
  for (const id of touched) {
    const extras = extrasByFingerprint.get(fingerprintOf.get(id) ?? "");
    if (extras) {
      statements.push(cloudColumnsStatement(db, id, source.id, extras));
    }
  }
  return statements;
}

/** The chunk's statements in execution order (guards first). */
function chunkStatements(
  db: JobsDb,
  source: CloudSourceRecord,
  candidates: readonly Candidate[],
  stored: Stored,
  plan: Plan,
  now: number
): D1PreparedStatement[] {
  const statements = plan.guards.map((g) => postingGuardStatement(db, g));
  for (const insert of plan.inserts) {
    statements.push(insertPostingStatement(db, insert.id, insert.values));
  }
  const sighted: string[] = [];
  for (const update of plan.updates) {
    if (isPureSighting(update)) {
      sighted.push(update.id);
      continue;
    }
    const statement = updatePostingStatement(db, update, now);
    if (statement) {
      statements.push(statement);
    }
  }
  statements.push(
    ...bulkSightingStatements(db, sighted, source.id, now),
    ...cloudColumnStatements(db, source, candidates, stored, plan),
    ...postingFanoutStatements(db, plan.fanout, now)
  );
  return statements;
}

function tally(plan: Plan, result: IngestResult): void {
  for (const item of plan.results) {
    if (item.outcome === "new") {
      result.new += 1;
      if (item.posting_id) {
        result.newPostingIds.push(item.posting_id);
      }
    } else if (item.outcome === "updated") {
      result.updated += 1;
    } else if (item.outcome === "unchanged") {
      result.unchanged += 1;
    } else {
      result.invalid += 1;
    }
  }
}

async function writeChunk(
  db: JobsDb,
  source: CloudSourceRecord,
  candidates: readonly Candidate[],
  now: number,
  result: IngestResult
): Promise<void> {
  const plan = await retryOnGuardFailure(async () => {
    const stored = await findPublicPostingsByFingerprint(
      db,
      candidates.map((c) => c.prepared.fingerprint)
    );
    const planned = await planBatch({
      items: candidates.map((c) => c.prepared),
      stored,
      links: new Map(),
      newId: (prefix) => newId(prefix, now),
      now,
      runId: "",
      userId: null,
    });
    await runCloudBatch(
      db,
      chunkStatements(db, source, candidates, stored, planned, now)
    );
    return planned;
  });
  tally(plan, result);
}

/** Stores one run's scraped items; never throws for a bad item. */
export async function ingestItems(
  db: JobsDb,
  input: {
    items: readonly unknown[];
    now: number;
    runId: string;
    source: CloudSourceRecord;
  }
): Promise<IngestResult> {
  const result: IngestResult = {
    found: input.items.length,
    new: 0,
    updated: 0,
    unchanged: 0,
    duplicates: 0,
    invalid: 0,
    newPostingIds: [],
    confidenceAvg: null,
    warnings: [],
  };
  const candidates = await prepareAll(
    input.items,
    input.source,
    input.runId,
    input.now,
    result
  );
  if (candidates.length > 0) {
    const total = candidates.reduce(
      (sum, c) => sum + (c.prepared.extraction.confidence ?? 0),
      0
    );
    result.confidenceAvg = Math.round((total / candidates.length) * 100) / 100;
  }
  for (const group of chunk(candidates, INGEST_CHUNK)) {
    await writeChunk(db, input.source, group, input.now, result);
  }
  result.warnings = mergeWarnings(result.warnings);
  return result;
}
