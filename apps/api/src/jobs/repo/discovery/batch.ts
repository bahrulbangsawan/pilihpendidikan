// Statements of one `postings:batch` (05 §4) in the order D1 executes them:
//
//   1. guards        revision + last_seen_at of every existing posting the
//                    batch changes (a concurrent change aborts the batch and
//                    the service re-plans, 20 §6.2)
//   2. postings      INSERT new rows / UPDATE existing ones (one each)
//   3. user_jobs     multi-row INSERT of the caller's new links
//   4. fan-out       `posting` change rows for every user linked to a
//                    changed posting (≤ 90 ids per statement)
//   5. change_log    the caller's remaining rows (multi-row)
//   6. run items     `discovery_run_items` (multi-row, first outcome wins)
//
// For 100 items that is at most 100 guards + 100 posting writes + 10 + 2 +
// 13 + 4 statements (≈ 230 < the 403 budget of 14 §4), every statement with
// ≤ 100 bound parameters.

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { guard } from "../core/db";
import type {
  NewUserJob,
  PostingUpdate,
  PostingValues,
  StoredPosting,
  UserJobLink,
} from "./postings";
import {
  findLinks,
  findPostingsByFingerprint,
  insertPostingStatement,
  insertRunItemStatements,
  insertUserJobStatements,
  postingFanoutStatements,
  postingGuardSql,
  updatePostingStatement,
} from "./postings";
import { changeLogRows } from "./sql";

export interface BatchContext {
  links: Map<string, UserJobLink>;
  stored: Map<string, StoredPosting>;
}

/** Stored postings (public + the caller's private) and the caller's links. */
export async function loadBatchContext(
  db: JobsDb,
  scope: UserScope,
  fingerprints: readonly string[]
): Promise<BatchContext> {
  const stored = await findPostingsByFingerprint(db, scope, fingerprints);
  const links = await findLinks(
    db,
    scope,
    [...stored.values()].map((posting) => posting.id)
  );
  return { stored, links };
}

export interface BatchWrites {
  changeLog: readonly {
    entity: "posting" | "user_job";
    entityId: string;
    revision: number;
  }[];
  fanout: readonly string[];
  guards: readonly { id: string; lastSeenAt: number; revision: number }[];
  inserts: readonly { id: string; values: PostingValues }[];
  newLinks: readonly NewUserJob[];
  runItems: readonly { outcome: string; postingId: string }[];
  updates: readonly PostingUpdate[];
}

/** The statements of a planned batch (without the idempotency rows). */
export function batchStatements(
  db: JobsDb,
  scope: UserScope,
  writes: BatchWrites,
  options: { now: number; runId: string }
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const g of writes.guards) {
    statements.push(
      guard(
        db,
        `posting:${g.id}`,
        postingGuardSql(),
        g.id,
        g.revision,
        g.lastSeenAt
      )
    );
  }
  for (const insert of writes.inserts) {
    statements.push(insertPostingStatement(db, insert.id, insert.values));
  }
  for (const update of writes.updates) {
    const statement = updatePostingStatement(db, update, options.now);
    if (statement) {
      statements.push(statement);
    }
  }
  statements.push(
    ...insertUserJobStatements(db, scope, writes.newLinks, options.now),
    ...postingFanoutStatements(db, writes.fanout, options.now),
    ...changeLogRows(db, scope, writes.changeLog, options.now),
    ...insertRunItemStatements(db, scope, options.runId, writes.runItems)
  );
  return statements;
}
