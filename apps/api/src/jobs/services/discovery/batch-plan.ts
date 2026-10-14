// The `postings:batch` merge planner (05 §4, 03 §4.3, 20 §6.2 / §7).
//
// Items are applied IN ORDER to an in-memory view of each posting the batch
// touches, so duplicates inside one batch behave like successive uploads.
// The plan then becomes ONE transactional D1 batch (repo/discovery/batch.ts).
//
// Merge rules for an existing posting (20 §6.2 "job_postings content"):
//   - last_seen_at = max(stored, observed_at); missed_runs = 0 on sight
//     ("reset on sight", 03 §4.3); first_seen_at is never touched
//   - content changes only when the server content_hash differs AND
//     observed_at ≥ stored last_seen_at (a stale observation cannot roll
//     content back, 20 §6.3 D); the merge is field-level: values the new
//     observation lacks (null / empty) keep the stored ones
//   - identity (fingerprint, source kind/org/ref, visibility, owner) and the
//     primary extraction provenance are kept; another adapter or listing
//     that produced the same fingerprint is recorded in
//     `extraction.alternates` (12 §4 duplicates list)
//   - status: `status_hint: closed` (+ evidence, 15 §12) closes an open
//     posting unless someone saw it after the check; a sighting (or an `open`
//     hint) reopens `unknown` postings and `closed` ones observed after
//     `closed_at`
//   - revision + 1 (and a `posting` change for every linked user) only for
//     content, status or provenance changes — never for a mere sighting
//
// user_jobs: a full item links the caller (origin `discovered`, inbox `new`)
// when no link exists; an existing link is never touched, so `tracked` and
// `dismissed` stay (20 §6.2, never downgraded). An unchanged-only item must
// refer to a posting already linked to the caller, else it is `invalid`
// (`unknown_fingerprint`) and the CLI re-sends it in full.
//
// Outcomes (per item and per discovery_run_items row): `new` = this batch
// linked the posting to the caller; `updated` = it changed the posting's
// content or status; `unchanged` otherwise; `invalid` for rejected items.
//
// System mode (`userId: null`, cloud discovery 24 §6.5): the same merge rules
// without a caller — no user_jobs links, run items or scoring; `new` means the
// batch inserted the posting. Followers are linked afterwards by the cloud
// service. Only public items are planned in system mode.

import {
  dedupeGroup,
  primaryLocation,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { ExtractionProvenance } from "@pilihpendidikan/jobs-contracts/records";
import type {
  NewUserJob,
  PostingUpdate,
  PostingValues,
  StoredPosting,
  UserJobLink,
} from "../../repo/discovery/postings";
import type {
  BatchItemError,
  InvalidItem,
  PreparedFullItem,
  PreparedItem,
  PreparedUnchangedItem,
} from "./batch-items";

export type ItemOutcome = "invalid" | "new" | "unchanged" | "updated";

export interface BatchItemResult {
  client_ref: string;
  errors?: BatchItemError[];
  outcome: ItemOutcome;
  posting_id?: string;
  user_job_id?: string;
}

export interface BatchPlan {
  /** Caller change_log rows not covered by the posting fan-out. */
  changeLog: {
    entity: "posting" | "user_job";
    entityId: string;
    revision: number;
  }[];
  /** Existing postings whose change goes to every linked user's feed. */
  fanout: string[];
  /** Revision guards of the existing postings the batch changes. */
  guards: { id: string; lastSeenAt: number; revision: number }[];
  inserts: { id: string; values: PostingValues }[];
  newLinks: NewUserJob[];
  results: BatchItemResult[];
  runItems: { outcome: "new" | "unchanged" | "updated"; postingId: string }[];
  /** Postings to score for the caller (07 §6, §7.1). */
  scorePostingIds: string[];
  updates: PostingUpdate[];
}

export interface PlanInput {
  items: readonly (InvalidItem | PreparedItem)[];
  links: ReadonlyMap<string, UserJobLink>;
  newId: (prefix: "pst" | "ujb") => string;
  now: number;
  runId: string;
  stored: ReadonlyMap<string, StoredPosting>;
  /** The caller; null plans in system mode (no links, 24 §6.5). */
  userId: string | null;
}

/** Most alternates kept per posting. */
export const MAX_ALTERNATES = 10;

interface Link {
  id: string;
  inboxState: string;
  isNew: boolean;
}

interface Working {
  changed: boolean;
  contentChanged: boolean;
  extractionChanged: boolean;
  id: string;
  lastCheckedAt: number | null;
  link: Link | null;
  sightedAt: number | null;
  statusChanged: boolean;
  /** null → the batch inserts this posting. */
  stored: StoredPosting | null;
  values: PostingValues;
}

const CONTENT_COLUMNS = [
  "title",
  "company_name",
  "company_domain",
  "canonical_url",
  "apply_url",
  "apply_domain",
  "department",
  "locations",
  "workplace_type",
  "employment_type",
  "seniority",
  "salary",
  "description_text",
  "description_truncated",
  "requirements",
  "posted_at",
  "content_hash",
  "dedupe_group",
  "application_support",
] as const satisfies readonly (keyof PostingValues)[];

function max(a: number | null, b: number): number {
  return a === null ? b : Math.max(a, b);
}

function known<T extends string>(value: T | null | undefined): T | null {
  return value === null || value === undefined || value === "unknown"
    ? null
    : value;
}

// ---------------------------------------------------------------------------
// Provenance alternates
// ---------------------------------------------------------------------------

type Provenance = Record<string, unknown>;

function listingOf(provenance: Provenance): string | null {
  const urls = provenance.source_urls as { listing?: string } | undefined;
  return urls?.listing ?? null;
}

function alternateEntry(incoming: ExtractionProvenance): Provenance {
  return {
    adapter: incoming.adapter,
    adapter_version: incoming.adapter_version,
    fetch_mode: incoming.fetch_mode,
    method: incoming.method,
    confidence: incoming.confidence,
    observed_at: incoming.observed_at,
    ...(incoming.source_urls ? { source_urls: incoming.source_urls } : {}),
    run_id: incoming.run_id ?? null,
  };
}

function sameSource(a: Provenance, b: Provenance): boolean {
  return a.adapter === b.adapter && listingOf(a) === listingOf(b);
}

/**
 * The stored provenance with `incoming` recorded: adopted as primary when the
 * posting has none, appended to `alternates` when another adapter/listing
 * produced the same fingerprint; null when nothing changes.
 */
export function mergeProvenance(
  stored: Provenance,
  incoming: ExtractionProvenance
): Provenance | null {
  if (typeof stored.adapter !== "string") {
    return { ...incoming };
  }
  const entry = alternateEntry(incoming);
  if (sameSource(stored, entry)) {
    return null;
  }
  const alternates = Array.isArray(stored.alternates)
    ? (stored.alternates as Provenance[])
    : [];
  if (alternates.some((alt) => sameSource(alt, entry))) {
    return null;
  }
  return {
    ...stored,
    alternates: [entry, ...alternates].slice(0, MAX_ALTERNATES),
  };
}

// ---------------------------------------------------------------------------
// Field-level content merge
// ---------------------------------------------------------------------------

async function mergeContent(
  values: PostingValues,
  item: PreparedFullItem
): Promise<PostingValues> {
  const c = item.content;
  const locations = c.locations.length > 0 ? c.locations : values.locations;
  const companyDomain = c.company_domain ?? values.company_domain;
  let applicationSupport = values.application_support;
  if (c.application_support === "prohibited") {
    applicationSupport = "prohibited";
  } else if (applicationSupport === "unknown" && c.application_support) {
    applicationSupport = c.application_support;
  }
  return {
    ...values,
    title: c.title,
    company_name: c.company_name,
    company_domain: companyDomain,
    canonical_url: c.canonical_url ?? values.canonical_url,
    apply_url: c.apply_url ?? values.apply_url,
    apply_domain: c.apply_url ? c.apply_domain : values.apply_domain,
    department: c.department ?? values.department,
    locations,
    workplace_type: known(c.workplace_type) ?? values.workplace_type,
    employment_type: known(c.employment_type) ?? values.employment_type,
    seniority: c.seniority ?? values.seniority,
    salary: c.salary ?? values.salary,
    description_text: c.description_text,
    description_truncated: c.description_truncated,
    requirements:
      c.requirements.length > 0 ? c.requirements : values.requirements,
    posted_at: c.posted_at ?? values.posted_at,
    content_hash: item.contentHash,
    dedupe_group: await dedupeGroup({
      company_domain: companyDomain,
      title: c.title,
      location_primary: primaryLocation(locations),
    }),
    application_support: applicationSupport,
  };
}

async function newPostingValues(
  item: PreparedFullItem,
  userId: string | null,
  now: number
): Promise<PostingValues> {
  const c = item.content;
  const closed = item.statusHint === "closed";
  return {
    fingerprint: item.fingerprint,
    visibility: item.visibility,
    owner_user_id: item.visibility === "private" ? userId : null,
    source_kind: item.sourceKind,
    source_org: item.sourceOrg,
    source_job_ref: item.sourceJobRef,
    canonical_url: c.canonical_url,
    apply_url: c.apply_url,
    apply_domain: c.apply_domain,
    company_name: c.company_name,
    company_domain: c.company_domain,
    title: c.title,
    department: c.department,
    locations: c.locations,
    workplace_type: c.workplace_type ?? "unknown",
    employment_type: c.employment_type ?? "unknown",
    seniority: c.seniority,
    salary: c.salary,
    description_text: c.description_text,
    description_truncated: c.description_truncated,
    requirements: c.requirements,
    content_hash: item.contentHash,
    dedupe_group: await dedupeGroup({
      company_domain: c.company_domain,
      title: c.title,
      location_primary: primaryLocation(c.locations),
    }),
    posted_at: c.posted_at,
    first_seen_at: item.observedAt,
    last_seen_at: item.observedAt,
    last_checked_at: item.statusHint ? item.observedAt : null,
    status: closed ? "closed" : "open",
    closed_at: closed ? item.observedAt : null,
    missed_runs: 0,
    extraction: item.extraction,
    application_support: c.application_support ?? "unknown",
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Applying items
// ---------------------------------------------------------------------------

function recordStatusCheck(
  w: Working,
  item: PreparedFullItem | PreparedUnchangedItem
): void {
  const provenance = w.values.extraction as Provenance;
  w.values.extraction = {
    ...provenance,
    status_check: {
      status: item.statusHint,
      http_status: item.statusEvidence?.http_status ?? null,
      marker: item.statusEvidence?.marker ?? null,
      checked_at: item.observedAt,
    },
  } as unknown as PostingValues["extraction"];
  w.extractionChanged = true;
}

/** A `status_hint: closed` report; true when it closed the posting. */
function applyClosure(
  w: Working,
  item: PreparedFullItem | PreparedUnchangedItem
): boolean {
  w.lastCheckedAt = max(w.lastCheckedAt, item.observedAt);
  if (w.values.status === "closed" || item.observedAt < w.values.last_seen_at) {
    return false;
  }
  w.values.status = "closed";
  w.values.closed_at = item.observedAt;
  w.statusChanged = true;
  recordStatusCheck(w, item);
  return true;
}

/** A sighting (listing, unchanged item or `open` hint); true on reopen. */
function applySighting(
  w: Working,
  item: PreparedFullItem | PreparedUnchangedItem
): boolean {
  const observed = item.observedAt;
  w.sightedAt = max(w.sightedAt, observed);
  w.values.last_seen_at = Math.max(w.values.last_seen_at, observed);
  w.values.missed_runs = 0;
  if (item.statusHint === "open") {
    w.lastCheckedAt = max(w.lastCheckedAt, observed);
  }
  const reopen =
    w.values.status === "unknown" ||
    (w.values.status === "closed" &&
      (w.values.closed_at === null || observed > w.values.closed_at));
  if (!reopen) {
    return false;
  }
  w.values.status = "open";
  w.values.closed_at = null;
  w.statusChanged = true;
  if (item.statusHint === "open") {
    recordStatusCheck(w, item);
  }
  return true;
}

/** Applies a full item to an existing (or in-batch new) posting. */
async function applyFull(w: Working, item: PreparedFullItem): Promise<boolean> {
  const provenance = mergeProvenance(
    w.values.extraction as Provenance,
    item.extraction
  );
  if (provenance) {
    w.values.extraction = provenance as PostingValues["extraction"];
    w.extractionChanged = true;
  }
  if (item.statusHint === "closed") {
    return applyClosure(w, item);
  }
  const contentChanged =
    item.contentHash !== w.values.content_hash &&
    item.observedAt >= w.values.last_seen_at;
  if (contentChanged) {
    w.values = await mergeContent(w.values, item);
    w.contentChanged = true;
  }
  const reopened = applySighting(w, item);
  return contentChanged || reopened;
}

function applyUnchanged(w: Working, item: PreparedUnchangedItem): boolean {
  return item.statusHint === "closed"
    ? applyClosure(w, item)
    : applySighting(w, item);
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

class Planner {
  readonly #input: PlanInput;
  readonly #byKey = new Map<string, Working>();
  readonly #order: Working[] = [];
  readonly #results: BatchItemResult[] = [];
  readonly #newLinkSource = new Map<string, string | null>();

  constructor(input: PlanInput) {
    this.#input = input;
  }

  async run(): Promise<BatchPlan> {
    for (const item of this.#input.items) {
      if (item.kind === "invalid") {
        this.#results.push({
          client_ref: item.clientRef,
          outcome: "invalid",
          errors: item.errors,
        });
      } else if (item.kind === "full") {
        await this.#full(item);
      } else {
        this.#unchanged(item);
      }
    }
    return this.#plan();
  }

  #existing(key: string): Working | null {
    const known = this.#byKey.get(key);
    if (known) {
      return known;
    }
    const stored = this.#input.stored.get(key);
    if (!stored) {
      return null;
    }
    const link = this.#input.links.get(stored.id);
    const w: Working = {
      id: stored.id,
      stored,
      values: { ...stored, description_text: "" },
      link: link
        ? { id: link.id, inboxState: link.inbox_state, isNew: false }
        : null,
      sightedAt: null,
      lastCheckedAt: null,
      contentChanged: false,
      statusChanged: false,
      extractionChanged: false,
      changed: false,
    };
    this.#byKey.set(key, w);
    this.#order.push(w);
    return w;
  }

  get #system(): boolean {
    return this.#input.userId === null;
  }

  async #full(item: PreparedFullItem): Promise<void> {
    const key = `${item.visibility}|${item.fingerprint}`;
    if (this.#system && item.visibility !== "public") {
      this.#results.push({
        client_ref: item.clientRef,
        outcome: "invalid",
        errors: [
          {
            code: "private_conflict",
            message: "System ingestion only stores public postings.",
            path: "visibility",
          },
        ],
      });
      return;
    }
    let w = this.#existing(key);
    let changed = false;
    let inserted = false;
    if (w) {
      changed = await applyFull(w, item);
    } else {
      w = {
        id: this.#input.newId("pst"),
        stored: null,
        values: await newPostingValues(
          item,
          this.#input.userId,
          this.#input.now
        ),
        link: null,
        sightedAt: item.observedAt,
        lastCheckedAt: null,
        contentChanged: false,
        statusChanged: false,
        extractionChanged: false,
        changed: false,
      };
      this.#byKey.set(key, w);
      this.#order.push(w);
      inserted = true;
    }
    w.changed ||= changed;
    if (this.#system) {
      this.#results.push({
        client_ref: item.clientRef,
        outcome: this.#outcome(inserted, changed),
        posting_id: w.id,
      });
      return;
    }
    let linkedNow = false;
    if (!w.link) {
      w.link = { id: this.#input.newId("ujb"), inboxState: "new", isNew: true };
      this.#newLinkSource.set(w.id, item.sourceId);
      linkedNow = true;
    }
    this.#results.push({
      client_ref: item.clientRef,
      outcome: this.#outcome(linkedNow, changed),
      posting_id: w.id,
      user_job_id: w.link.id,
    });
  }

  #unchanged(item: PreparedUnchangedItem): void {
    const w =
      this.#existing(`private|${item.fingerprint}`) ??
      this.#existing(`public|${item.fingerprint}`);
    if (!w?.link) {
      this.#results.push({
        client_ref: item.clientRef,
        outcome: "invalid",
        errors: [
          {
            code: "unknown_fingerprint",
            message:
              "No posting with this fingerprint is linked to you; send the full item.",
            path: "fingerprint",
          },
        ],
      });
      return;
    }
    const changed = applyUnchanged(w, item);
    w.changed ||= changed;
    this.#results.push({
      client_ref: item.clientRef,
      outcome: changed ? "updated" : "unchanged",
      posting_id: w.id,
      user_job_id: w.link.id,
    });
  }

  #outcome(linkedNow: boolean, changed: boolean): ItemOutcome {
    if (linkedNow) {
      return "new";
    }
    return changed ? "updated" : "unchanged";
  }

  #plan(): BatchPlan {
    const plan: BatchPlan = {
      results: this.#results,
      inserts: [],
      updates: [],
      guards: [],
      fanout: [],
      newLinks: [],
      changeLog: [],
      runItems: [],
      scorePostingIds: [],
    };
    for (const w of this.#order) {
      this.#planPosting(plan, w);
    }
    return plan;
  }

  #planPosting(plan: BatchPlan, w: Working): void {
    if (this.#system) {
      if (w.stored) {
        this.#planExisting(plan, w, w.stored);
      } else {
        plan.inserts.push({ id: w.id, values: w.values });
      }
      return;
    }
    const link = w.link;
    if (!link) {
      // Touched only by items that were rejected afterwards: nothing to do.
      return;
    }
    if (w.stored) {
      this.#planExisting(plan, w, w.stored);
    } else {
      plan.inserts.push({ id: w.id, values: w.values });
      plan.changeLog.push({ entity: "posting", entityId: w.id, revision: 1 });
    }
    if (link.isNew) {
      plan.newLinks.push({
        id: link.id,
        postingId: w.id,
        origin: "discovered",
        inboxState: "new",
        firstRunId: this.#input.runId,
        sourceId: this.#newLinkSource.get(w.id) ?? null,
        userNotes: "",
      });
      plan.changeLog.push({
        entity: "user_job",
        entityId: link.id,
        revision: 1,
      });
    }
    let outcome: "new" | "unchanged" | "updated" = "unchanged";
    if (link.isNew) {
      outcome = "new";
    } else if (w.changed) {
      outcome = "updated";
    }
    plan.runItems.push({ postingId: w.id, outcome });
    const rescore =
      w.contentChanged && ["new", "seen", "tracked"].includes(link.inboxState);
    if (link.isNew || rescore) {
      plan.scorePostingIds.push(w.id);
    }
  }

  #planExisting(plan: BatchPlan, w: Working, stored: StoredPosting): void {
    const bump = w.contentChanged || w.statusChanged || w.extractionChanged;
    const content: Partial<PostingValues> | null = w.contentChanged
      ? Object.fromEntries(
          CONTENT_COLUMNS.map((column) => [column, w.values[column]])
        )
      : null;
    const update: PostingUpdate = {
      id: w.id,
      content,
      extraction: w.extractionChanged
        ? (w.values.extraction as Record<string, unknown>)
        : null,
      status: w.statusChanged
        ? { status: w.values.status, closedAt: w.values.closed_at }
        : null,
      sightedAt: w.sightedAt,
      lastCheckedAt: w.lastCheckedAt,
      revisionBump: bump,
    };
    plan.updates.push(update);
    if (bump) {
      plan.guards.push({
        id: w.id,
        revision: stored.revision,
        lastSeenAt: stored.last_seen_at,
      });
      plan.fanout.push(w.id);
    } else if (w.link?.isNew) {
      plan.changeLog.push({
        entity: "posting",
        entityId: w.id,
        revision: stored.revision,
      });
    }
  }
}

/** Plans one `postings:batch` against the stored state. */
export async function planBatch(input: PlanInput): Promise<BatchPlan> {
  return await new Planner(input).run();
}
