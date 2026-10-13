// Idempotency keys (05 §1.4): one per user intent. A retry of the same intent
// (a network failure, a reconnect) reuses the key, so the API applies it once.

import { newId } from "@pilihpendidikan/jobs-contracts/ids";

/** A fresh key for one intent: `web:` + a ULID (≤ 128 chars). */
export function newIdempotencyKey(): string {
  return `web:${newId("evt").slice(4)}`;
}
