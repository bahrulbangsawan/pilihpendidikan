// `GET /api/v1/snapshot?entities=…` (05 §11, 20 §4.2): the user's full state
// for initial sync and recovery after `410 cursor_expired`.
//
// The cursor is taken FIRST (the change log head), then the collections are
// read; a write that lands during the read has a higher seq, so the client's
// next pull from `cursor` re-delivers it (a duplicate is harmless: the client
// keeps the higher revision). Every read carries the user predicate; postings
// are the ones the user can see (private own, or public via own user_jobs).

import type { SnapshotResponse } from "@pilihpendidikan/jobs-contracts/api";
import type { SnapshotEntity } from "@pilihpendidikan/jobs-contracts/enums";
import { SNAPSHOT_ENTITIES } from "@pilihpendidikan/jobs-contracts/enums";
import { invalidRequest } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import {
  changeLogHead,
  snapshotPostings,
  snapshotRows,
} from "../../repo/sync/changes";

const KNOWN: ReadonlySet<string> = new Set(SNAPSHOT_ENTITIES);

/** Parses `entities=a,b` (default: every collection); unknown → 400. */
export function parseSnapshotEntities(
  raw: string | undefined
): SnapshotEntity[] {
  if (raw === undefined || raw.trim() === "") {
    return [...SNAPSHOT_ENTITIES];
  }
  const names = [
    ...new Set(
      raw
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ];
  const unknown = names.filter((name) => !KNOWN.has(name));
  if (unknown.length > 0 || names.length === 0) {
    throw invalidRequest(`Unknown entities: ${unknown.join(", ")}.`, [
      {
        code: "invalid_value",
        path: ["entities"],
        message: `expected any of ${SNAPSHOT_ENTITIES.join(", ")}`,
      },
    ]);
  }
  return names as SnapshotEntity[];
}

/** The snapshot of `entities`, with the cursor taken before any read. */
export async function readSnapshot(
  db: JobsDb,
  scope: UserScope,
  input: { entities: string | undefined; now: number }
): Promise<SnapshotResponse> {
  const entities = parseSnapshotEntities(input.entities);
  const cursor = await changeLogHead(db);
  const out: Record<string, unknown> = { cursor, taken_at: input.now };
  for (const entity of entities) {
    if (entity === "settings") {
      out.settings = await getUserSettings(db, scope, input.now);
    } else if (entity === "postings") {
      out.postings = await snapshotPostings(db, scope);
    } else {
      out[entity] = await snapshotRows(db, scope, entity);
    }
  }
  return out as SnapshotResponse;
}
