// `POST /api/v1/discovery/runs/{run_id}/postings:batch` (05 §4, 20 §7).
//
// validate items (batch-items.ts) → plan the merge (batch-plan.ts) → ONE
// batch (repo/discovery/batch.ts) with the idempotency row → queue scoring
// for the postings newly linked to the caller (07 §7.1: placeholders are
// inserted ON CONFLICT DO NOTHING and only inserted rows send a message, so
// a duplicate batch never sends a second one — T7-06).

import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { DiscoveryContext } from "./context";
import { apiError, notFound } from "../../core/http";
import { getProfileVersion } from "../../repo/core/profile-version";
import { enqueueScoring } from "../../repo/core/score-queue";
import { batchStatements, loadBatchContext } from "../../repo/discovery/batch";
import { ownedSourceIds } from "../../repo/discovery/postings";
import { getRun } from "../../repo/discovery/runs";
import { BATCH_STATEMENT_BUDGET } from "../../repo/discovery/sql";
import type { InvalidItem, PreparedItem } from "./batch-items";
import { prepareItem, referencedSourceIds } from "./batch-items";
import type { BatchItemResult } from "./batch-plan";
import { planBatch } from "./batch-plan";
import { commitPlanned } from "./commit";

/** The run must be the caller's and come from the device that started it. */
export async function loadDeviceRun(c: DiscoveryContext, runId: string) {
  const run = await getRun(c.db, c.scope, runId);
  if (!run) {
    throw notFound("Discovery run not found.");
  }
  if (c.caller.deviceId !== run.device_id) {
    throw apiError(
      "device_required",
      "Only the device that started this run can report to it."
    );
  }
  return run;
}

async function queueScoring(
  c: DiscoveryContext,
  postingIds: readonly string[]
): Promise<void> {
  if (postingIds.length === 0) {
    return;
  }
  try {
    const profileVersion = await getProfileVersion(c.env, c.db, c.scope, c, {
      email: c.caller.email,
    });
    await enqueueScoring(c.env, c.db, c.scope, {
      postingIds,
      profileVersion,
      now: c.now,
    });
  } catch (err) {
    // The postings are linked; the inbox can re-request scores (inbox:bulk
    // `score`). Never fail an already-committed batch on the queue.
    console.warn({
      evt: "discovery_score_enqueue_failed",
      request_id: c.requestId,
      postings: postingIds.length,
      error: err instanceof Error ? err.name : String(err),
    });
  }
}

/** Handles one postings batch; per-item outcomes in `items[]`. */
export async function postPostingsBatch(
  c: DiscoveryContext,
  runId: string,
  rawItems: readonly unknown[]
): Promise<Response> {
  const run = await loadDeviceRun(c, runId);
  const ownedSources = await ownedSourceIds(
    c.db,
    c.scope,
    referencedSourceIds(rawItems)
  );
  const context = {
    now: c.now,
    runId: run.id,
    deviceId: c.caller.deviceId,
    ownedSources,
  };
  const items: (InvalidItem | PreparedItem)[] = [];
  for (const [index, raw] of rawItems.entries()) {
    items.push(await prepareItem(raw, index, context));
  }
  const fingerprints = items.flatMap((item) =>
    item.kind === "invalid" ? [] : [item.fingerprint]
  );
  const { extra, response } = await commitPlanned(c, async () => {
    const stored = await loadBatchContext(c.db, c.scope, fingerprints);
    const plan = await planBatch({
      items,
      stored: stored.stored,
      links: stored.links,
      newId: (prefix) => newId(prefix, c.now),
      now: c.now,
      runId: run.id,
      userId: c.scope.userId,
    });
    const statements = batchStatements(c.db, c.scope, plan, {
      now: c.now,
      runId: run.id,
    });
    if (statements.length > BATCH_STATEMENT_BUDGET) {
      throw new Error(
        `postings batch planned ${statements.length} statements (budget ${BATCH_STATEMENT_BUDGET})`
      );
    }
    const body: { items: BatchItemResult[] } = { items: plan.results };
    return { status: 200, body, statements, extra: plan.scorePostingIds };
  });
  if (extra) {
    await queueScoring(c, extra);
  }
  return response;
}
