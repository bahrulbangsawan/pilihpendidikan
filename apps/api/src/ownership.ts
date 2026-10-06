// Who owns a document. Ownership is stamped once, at create time, under an
// `owner:*` key next to the document in the same namespace (key shapes are
// unchanged from the old backend so migrated data keeps its owners):
//
//   cv         CV_KV         owner:cv:{id}
//   invoice    INVOICE_KV    owner:inv:{id}
//   portfolio  PORTFOLIO_KV  owner:portfolio:{id}
//   jobs       JOBS_KV       owner:job:{id}
//
// A document without a stamp (written before stamps existed) is reachable
// only by admins (ADMIN_EMAILS). The MCP ownership guard and every REST
// handler resolve ownership through this one module.

import type { Caller } from "./auth";
import type { Env } from "./env";

export type OwnedKind = "cv" | "invoice" | "portfolio" | "jobs";

const OWNER_PREFIX: Readonly<Record<OwnedKind, string>> = {
  cv: "owner:cv:",
  invoice: "owner:inv:",
  portfolio: "owner:portfolio:",
  jobs: "owner:job:",
};

export function namespaceFor(env: Env, kind: OwnedKind): KVNamespace {
  switch (kind) {
    case "cv":
      return env.CV_KV;
    case "invoice":
      return env.INVOICE_KV;
    case "portfolio":
      return env.PORTFOLIO_KV;
    default:
      return env.JOBS_KV;
  }
}

export function ownerKey(kind: OwnedKind, id: string): string {
  return `${OWNER_PREFIX[kind]}${id}`;
}

export async function resolveOwner(
  env: Env,
  kind: OwnedKind,
  id: string
): Promise<string | null> {
  return await namespaceFor(env, kind).get(ownerKey(kind, id));
}

export async function stampOwner(
  env: Env,
  kind: OwnedKind,
  id: string,
  email: string
): Promise<void> {
  await namespaceFor(env, kind).put(ownerKey(kind, id), email);
}

export async function clearOwner(
  env: Env,
  kind: OwnedKind,
  id: string
): Promise<void> {
  await namespaceFor(env, kind).delete(ownerKey(kind, id));
}

// Admins bypass; everyone else needs the stamp to equal their email.
export async function ownsDocument(
  caller: Caller,
  env: Env,
  kind: OwnedKind,
  id: string
): Promise<boolean> {
  if (caller.isAdmin) {
    return true;
  }
  return (await resolveOwner(env, kind, id)) === caller.email;
}

// The subset of `ids` stamped to `email`. Strict (no admin bypass): callers
// layer their own admin policy on top.
export async function idsOwnedBy(
  env: Env,
  kind: OwnedKind,
  email: string,
  ids: string[]
): Promise<Set<string>> {
  const checked = await Promise.all(
    ids.map(async (id) => ({ id, owner: await resolveOwner(env, kind, id) }))
  );
  return new Set(checked.filter((c) => c.owner === email).map((c) => c.id));
}

export function ownsJob(
  caller: Caller,
  env: Env,
  jobId: string
): Promise<boolean> {
  return ownsDocument(caller, env, "jobs", jobId);
}

export function jobIdsOwnedBy(
  env: Env,
  email: string,
  jobIds: string[]
): Promise<Set<string>> {
  return idsOwnedBy(env, "jobs", email, jobIds);
}

const LIST_PAGE_LIMIT = 1000;
// Upper bound on pages scanned per listing (10k documents).
const LIST_MAX_PAGES = 10;

export interface ListedKey<M> {
  name: string;
  metadata: M | undefined;
}

// Every key under `prefix`, following KV list cursors.
export async function listAllKeys<M>(
  kv: KVNamespace,
  prefix: string
): Promise<ListedKey<M>[]> {
  const keys: ListedKey<M>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const result: KVNamespaceListResult<M> = await kv.list<M>({
      prefix,
      limit: LIST_PAGE_LIMIT,
      cursor,
    });
    for (const key of result.keys) {
      keys.push({ name: key.name, metadata: key.metadata });
    }
    if (result.list_complete) {
      break;
    }
    cursor = result.cursor;
  }
  return keys;
}
