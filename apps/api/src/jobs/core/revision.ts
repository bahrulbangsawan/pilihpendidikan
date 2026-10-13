// Optimistic concurrency (D-21, 05 §1.6, 20 §6.1).
//
// Every mutable record has an integer `revision` (starts at 1, +1 on every
// update in the same statement). A conditional write names the revision it
// was based on, in the body (`base_revision`) or as `If-Match: "<revision>"`.
// A stale write answers `409 revision_conflict` with `details.current` = the
// full current resource, so clients can merge.
//
//   const base = baseRevision(c.request, c.body.base_revision); // 400 if absent
//   const current = await getInterview(c.db, c.scope, id);      // 404 if absent
//   assertRevision(current, base, toApiInterview);              // 409 if stale
//   … build the UPDATE with `WHERE revision = ?` + guardRevision(…) …
//
// Append-only records (events, evidence, run items, step logs) never carry a
// base revision (20 §6.1).

import { invalidRequest, revisionConflict } from "./http";

const IF_MATCH_RE = /^(?:W\/)?"?(\d+)"?$/;

/** Parses `If-Match: "7"` (or `7`); null when absent. */
export function ifMatchRevision(request: Request): number | null {
  const header = request.headers.get("If-Match");
  if (header === null || header.trim() === "") {
    return null;
  }
  const match = IF_MATCH_RE.exec(header.trim());
  if (!match) {
    throw invalidRequest('If-Match must be a quoted revision, e.g. "7".');
  }
  return Number(match[1]);
}

/**
 * The base revision of a conditional write: the body's `base_revision` or the
 * `If-Match` header. Both present and different → 400; neither → 400 unless
 * `optional` (then null).
 */
export function baseRevision(
  request: Request,
  bodyValue: number | null | undefined,
  options: { optional: true }
): number | null;
export function baseRevision(
  request: Request,
  bodyValue: number | null | undefined,
  options?: { optional?: false }
): number;
export function baseRevision(
  request: Request,
  bodyValue: number | null | undefined,
  options: { optional?: boolean } = {}
): number | null {
  const header = ifMatchRevision(request);
  const body = typeof bodyValue === "number" ? bodyValue : null;
  if (body !== null && (!Number.isInteger(body) || body < 1)) {
    throw invalidRequest("base_revision must be a positive integer.");
  }
  if (body !== null && header !== null && body !== header) {
    throw invalidRequest("base_revision and If-Match disagree.");
  }
  const value = body ?? header;
  if (value === null && !options.optional) {
    throw invalidRequest(
      'This write needs base_revision (or If-Match: "<revision>").'
    );
  }
  return value;
}

/**
 * Throws `409 revision_conflict` unless `current.revision === base`.
 * `present` maps the stored row to its API representation for
 * `details.current` (defaults to the row itself).
 */
export function assertRevision<T extends { revision: number }>(
  current: T,
  base: number,
  present: (row: T) => unknown = (row) => row
): void {
  if (current.revision !== base) {
    throw revisionConflict(
      present(current),
      `Changed since revision ${base} (now ${current.revision}).`
    );
  }
}
