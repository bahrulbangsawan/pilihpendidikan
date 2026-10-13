// Sync services (leaf-2.8, 05 §11, 20 §4): the cross-area entry points of
// the change feed and snapshots (the legacy facade and MCP tools page
// through the same feed the CLI reads).
//
//   changesPage     one page of the user's change feed (410 when expired)
//   fullSnapshot    the user's full state + the cursor taken at its start

import type {
  ChangesResponse,
  SnapshotResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import type { ChangesQuery } from "./changes";
import { readChanges } from "./changes";
import { readSnapshot } from "./snapshot";

/** One page of the user's change feed. */
export function changesPage(
  identity: D1Database,
  db: JobsDb,
  scope: UserScope,
  query: ChangesQuery
): Promise<ChangesResponse> {
  return readChanges(identity, db, scope, query);
}

/** The full snapshot of the user (every collection). */
export function fullSnapshot(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<SnapshotResponse> {
  return readSnapshot(db, scope, { entities: undefined, now });
}
