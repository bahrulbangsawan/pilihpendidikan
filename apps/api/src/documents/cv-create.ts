// Creating a CV document (08 §5): the one code path behind MCP `cv_create`
// and the Job Tracker's tailored variants.
//
//   createCvDocument(env, owner, id, data, {replaceOwned?})
//     KV `cv:{id}` (+ list metadata) and the owner stamp `owner:cv:{id}` with
//     the owner's email. An existing id is refused (`duplicate`), except that
//     `replaceOwned` lets the SAME owner overwrite it: the tailoring consumer
//     derives its slug deterministically, so a retried message rewrites the
//     document it already created (14 §6).
//
// Visibility (D-25): `visibility: "private"` makes a document owner-only on
// the public routes (handlers.ts); absent means "public", today's behaviour.
// Tailored variants are always written private, under a `-t-` slug.

import { CVDataSchema } from "@pilihpendidikan/cv-engine";
import type { Env } from "../env";
import type { CVMetadata } from "../helpers";
import { canonicalJson, sha256Hex } from "../jobs/services/cv/canonical";
import { ownerKey } from "../ownership";
import type { CVData } from "../types";

/** `<base>-t-<10 Crockford base32>` (08 §5). */
export const TAILORED_SLUG_RE = /-t-[0-9a-hjkmnp-tv-z]{10}$/;

/** True for the slug of a tailored variant document (08 §5, §9). */
export function isTailoredCvId(id: string): boolean {
  return TAILORED_SLUG_RE.test(id);
}

/** D-25: a stored CV is private only when it says so; absent = public. */
export function isPrivateCv(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { visibility?: unknown }).visibility === "private"
  );
}

/** "public" | "private" of a stored document (absent = public). */
export function cvVisibilityOf(data: unknown): "public" | "private" {
  return isPrivateCv(data) ? "private" : "public";
}

/**
 * sha256 of the canonical JSON of the document's normalized CVData (08 §5
 * "edited after approval"). Normalizing first (CVDataSchema drops unknown
 * keys and fills defaults) means a builder save that changes nothing visible
 * keeps the same fingerprint; a document that no longer parses is hashed raw.
 */
export async function cvCanonicalSha256(data: unknown): Promise<string> {
  const parsed = CVDataSchema.safeParse(data);
  return await sha256Hex(canonicalJson(parsed.success ? parsed.data : data));
}

export interface CvOwner {
  email: string;
}

export type CreateCvDocumentResult =
  | { created: boolean; ok: true }
  | { ok: false; reason: "duplicate" };

function metadataOf(data: CVData): CVMetadata {
  return {
    fullName: data.personalInfo?.fullName || "",
    jobTitle: data.personalInfo?.jobTitle || "",
  };
}

/**
 * Writes `cv:{id}` and stamps its owner. Refuses an existing id unless
 * `replaceOwned` is set and the existing document belongs to `owner`
 * (`created: false` then). A null owner writes no stamp (an unauthenticated
 * MCP session, which only admins can reach afterwards).
 */
export async function createCvDocument(
  env: Pick<Env, "CV_KV">,
  owner: CvOwner | null,
  id: string,
  data: CVData,
  options: { replaceOwned?: boolean } = {}
): Promise<CreateCvDocumentResult> {
  const existing = await env.CV_KV.get(`cv:${id}`);
  if (existing !== null) {
    const stamp = await env.CV_KV.get(ownerKey("cv", id));
    const sameOwner = owner !== null && stamp === owner.email;
    if (!(options.replaceOwned && sameOwner)) {
      return { ok: false, reason: "duplicate" };
    }
  }
  await env.CV_KV.put(`cv:${id}`, JSON.stringify(data), {
    metadata: metadataOf(data),
  });
  if (owner) {
    await env.CV_KV.put(ownerKey("cv", id), owner.email);
  }
  return { ok: true, created: existing === null };
}

/** Removes a CV document and its owner stamp (variant deletion, 08 §9). */
export async function deleteCvDocument(
  env: Pick<Env, "CV_KV">,
  id: string
): Promise<void> {
  await env.CV_KV.delete(`cv:${id}`);
  await env.CV_KV.delete(ownerKey("cv", id));
}
