// The fact sheet (05 §10, 03 §9): bulk upsert with per-fact `base_revision`.
//
// `PUT /api/v1/profile/facts` takes up to 200 facts and 200 deletions. Each
// fact is judged on its own (the response carries one result per key):
//
//   invalid    not a canonical key (packages/jobs-contracts facts.ts), a value
//              that fails the key's schema, a `verified_document` source
//              (server-only), a CV reference the caller does not own, an
//              unknown time zone, or a key named twice in the request
//   unchanged  same value, source and CV reference as stored (a retried
//              request converges without a conflict)
//   created    no row and no `base_revision` (absent = create)
//   updated    `base_revision` equals the stored revision
//   conflict   stale or missing `base_revision` on an existing row, or a
//              `base_revision` for a row that no longer exists; `current`
//              is the stored record (D-21)
//
// Everything that is not invalid or a conflict is written in ONE batch with
// guards; a concurrent change re-plans the whole request. `prefs.timezone`
// and `prefs.ai_scoring_sensitive` mirror `user_settings` (03 §9), so their
// writes update the settings row in the same batch.

import type { PutFactsRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { FactSource } from "@pilihpendidikan/jobs-contracts/enums";
import {
  factKeySpec,
  validateFactValue,
} from "@pilihpendidikan/jobs-contracts/facts";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { ApplicantFactRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { UserScope } from "../../core/scope";
import { mirrorSettingsStatements } from "../../repo/account/settings";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import {
  deleteFactStatements,
  insertFactStatements,
  listFacts,
  updateFactStatements,
} from "../../repo/profile/facts";
import { canonicalJson, isValidTimeZone, ownedCvIds } from "./shared";

export const PRIMARY_CV_KEY = "profile.primary_cv_id";
export const TIMEZONE_FACT = "prefs.timezone";
export const AI_SENSITIVE_FACT = "prefs.ai_scoring_sensitive";

const CV_REF_KEY_RE = /^(education|experience)\[([A-Za-z0-9_.:-]{1,80})\]$/;

export type FactStatus =
  | "created"
  | "updated"
  | "deleted"
  | "unchanged"
  | "conflict"
  | "invalid";

export interface FactResult {
  current?: ApplicantFactRecord;
  error?: string;
  fact?: ApplicantFactRecord;
  key: string;
  status: FactStatus;
}

export interface PutFactsPlan {
  /** True when at least one fact was created, updated or deleted. */
  changed: boolean;
  /** The whole fact sheet after the write, ordered by key. */
  facts: ApplicantFactRecord[];
  results: FactResult[];
  statements: D1PreparedStatement[];
  /** The settings timezone changed through the `prefs.timezone` mirror. */
  timezoneChanged: boolean;
}

type FactInput = PutFactsRequest["facts"][number];

interface Resolved {
  cvEntryId: string | null;
  cvId: string | null;
  source: FactSource;
  value: unknown;
}

interface PlanState {
  byKey: Map<string, ApplicantFactRecord>;
  changed: boolean;
  now: number;
  results: FactResult[];
  statements: D1PreparedStatement[];
}

function cvRefOf(value: unknown): { cvEntryId: string; cvId: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const ref = value as { cv_entry_id?: unknown; cv_id?: unknown };
  return typeof ref.cv_id === "string" && typeof ref.cv_entry_id === "string"
    ? { cvId: ref.cv_id, cvEntryId: ref.cv_entry_id }
    : null;
}

/** CV ids a request refers to (ownership is checked once for all). */
function referencedCvIds(facts: readonly FactInput[]): Set<string> {
  const ids = new Set<string>();
  for (const fact of facts) {
    if (typeof fact.cv_id === "string" && fact.cv_id.length > 0) {
      ids.add(fact.cv_id);
    }
    if (fact.key === PRIMARY_CV_KEY && typeof fact.value === "string") {
      ids.add(fact.value);
    }
    const ref = CV_REF_KEY_RE.test(fact.key) ? cvRefOf(fact.value) : null;
    if (ref) {
      ids.add(ref.cvId);
    }
  }
  return ids;
}

function resolveCvRef(
  fact: FactInput
): { error: string } | { cvEntryId: string | null; cvId: string | null } {
  const keyMatch = CV_REF_KEY_RE.exec(fact.key);
  if (keyMatch) {
    const ref = cvRefOf(fact.value);
    if (!ref) {
      return { error: "CV references need {cv_id, cv_entry_id}." };
    }
    if (ref.cvEntryId !== keyMatch[2]) {
      return { error: "cv_entry_id must match the key's entry id." };
    }
    if (
      (fact.cv_id && fact.cv_id !== ref.cvId) ||
      (fact.cv_entry_id && fact.cv_entry_id !== ref.cvEntryId)
    ) {
      return { error: "cv_id / cv_entry_id must match the value." };
    }
    return { cvId: ref.cvId, cvEntryId: ref.cvEntryId };
  }
  const cvId = fact.cv_id ?? null;
  const cvEntryId = fact.cv_entry_id ?? null;
  if (cvEntryId !== null && cvId === null) {
    return { error: "cv_entry_id needs cv_id." };
  }
  return { cvId, cvEntryId };
}

/** Validates one fact; the resolved write or the reason it is invalid. */
function resolveFact(
  fact: FactInput,
  owned: ReadonlySet<string>
): Resolved | { error: string } {
  if (!factKeySpec(fact.key)) {
    return { error: `unknown fact key ${fact.key}` };
  }
  const valid = validateFactValue(fact.key, fact.value);
  if (!valid.ok) {
    return { error: valid.error };
  }
  const source = fact.source ?? "user_entered";
  if (source === "verified_document") {
    return { error: "verified_document facts are recorded by the server." };
  }
  const ref = resolveCvRef(fact);
  if ("error" in ref) {
    return ref;
  }
  if (source === "cv_import" && ref.cvId === null) {
    return { error: "cv_import facts name the cv_id they came from." };
  }
  const cvIds = [ref.cvId, fact.key === PRIMARY_CV_KEY ? fact.value : null];
  for (const cvId of cvIds) {
    if (typeof cvId === "string" && !owned.has(cvId)) {
      return { error: "CV not found." };
    }
  }
  if (
    fact.key === TIMEZONE_FACT &&
    !isValidTimeZone(String(fact.value ?? ""))
  ) {
    return { error: "prefs.timezone must be an IANA time zone." };
  }
  return { value: fact.value, source, ...ref };
}

function sameContent(current: ApplicantFactRecord, next: Resolved): boolean {
  return (
    canonicalJson(current.value) === canonicalJson(next.value) &&
    current.source === next.source &&
    current.cv_id === next.cvId &&
    current.cv_entry_id === next.cvEntryId
  );
}

/** Keys named more than once across `facts` and `delete_keys`. */
function duplicateKeys(request: PutFactsRequest): Set<string> {
  const counts = new Map<string, number>();
  const keys = [
    ...request.facts.map((f) => f.key),
    ...(request.delete_keys ?? []),
  ];
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
}

function planCreate(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  key: string,
  next: Resolved
): void {
  const fact: ApplicantFactRecord = {
    id: newId("fct", state.now),
    user_id: scope.userId,
    key,
    value: next.value as ApplicantFactRecord["value"],
    source: next.source,
    cv_id: next.cvId,
    cv_entry_id: next.cvEntryId,
    revision: 1,
    created_at: state.now,
    updated_at: state.now,
  };
  state.statements.push(
    ...insertFactStatements(db, scope, {
      ...next,
      id: fact.id,
      key,
      now: state.now,
    })
  );
  state.byKey.set(key, fact);
  state.changed = true;
  state.results.push({ key, status: "created", fact });
}

function planUpdate(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  current: ApplicantFactRecord,
  next: Resolved
): void {
  const fact: ApplicantFactRecord = {
    ...current,
    value: next.value as ApplicantFactRecord["value"],
    source: next.source,
    cv_id: next.cvId,
    cv_entry_id: next.cvEntryId,
    revision: current.revision + 1,
    updated_at: state.now,
  };
  state.statements.push(
    ...updateFactStatements(db, scope, {
      ...next,
      id: current.id,
      baseRevision: current.revision,
      now: state.now,
    })
  );
  state.byKey.set(current.key, fact);
  state.changed = true;
  state.results.push({ key: current.key, status: "updated", fact });
}

function planFact(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  fact: FactInput,
  next: Resolved
): void {
  const current = state.byKey.get(fact.key);
  if (current && sameContent(current, next)) {
    state.results.push({ key: fact.key, status: "unchanged", fact: current });
    return;
  }
  if (!current) {
    if (fact.base_revision !== undefined) {
      state.results.push({
        key: fact.key,
        status: "conflict",
        error: "This fact no longer exists.",
      });
      return;
    }
    planCreate(db, scope, state, fact.key, next);
    return;
  }
  if (fact.base_revision !== current.revision) {
    state.results.push({
      key: fact.key,
      status: "conflict",
      current,
      error:
        fact.base_revision === undefined
          ? "This fact exists; send its base_revision to change it."
          : `Changed since revision ${fact.base_revision} (now ${current.revision}).`,
    });
    return;
  }
  planUpdate(db, scope, state, current, next);
}

function planDelete(
  db: JobsDb,
  scope: UserScope,
  state: PlanState,
  key: string
): void {
  const current = state.byKey.get(key);
  if (!current) {
    state.results.push({ key, status: "unchanged" });
    return;
  }
  state.statements.push(
    ...deleteFactStatements(db, scope, {
      id: current.id,
      revision: current.revision,
      now: state.now,
    })
  );
  state.byKey.delete(key);
  state.changed = true;
  state.results.push({ key, status: "deleted" });
}

/** The settings columns a written mirror fact changes, if any. */
async function planSettingsMirror(
  db: JobsDb,
  scope: UserScope,
  state: PlanState
): Promise<{ statements: D1PreparedStatement[]; timezoneChanged: boolean }> {
  const written = new Map(
    state.results
      .filter((r) => r.status === "created" || r.status === "updated")
      .map((r) => [r.key, r.fact?.value] as const)
  );
  const timezone = written.get(TIMEZONE_FACT);
  const sensitive = written.get(AI_SENSITIVE_FACT);
  if (timezone === undefined && sensitive === undefined) {
    return { statements: [], timezoneChanged: false };
  }
  const settings = await getUserSettings(db, scope, state.now);
  const changes: { ai_scoring_sensitive?: boolean; timezone?: string } = {};
  if (typeof timezone === "string" && timezone !== settings.timezone) {
    changes.timezone = timezone;
  }
  if (
    typeof sensitive === "boolean" &&
    sensitive !== settings.ai_scoring_sensitive
  ) {
    changes.ai_scoring_sensitive = sensitive;
  }
  return {
    statements: mirrorSettingsStatements(db, scope, {
      changes,
      now: state.now,
    }),
    timezoneChanged: changes.timezone !== undefined,
  };
}

/** Plans `PUT /api/v1/profile/facts` from fresh reads. */
export async function planPutFacts(
  env: Pick<Env, "CV_KV">,
  db: JobsDb,
  scope: UserScope,
  input: { email: string; now: number; request: PutFactsRequest }
): Promise<PutFactsPlan> {
  const { request } = input;
  const existing = await listFacts(db, scope);
  const state: PlanState = {
    byKey: new Map(existing.map((fact) => [fact.key, fact])),
    changed: false,
    now: input.now,
    results: [],
    statements: [],
  };
  const duplicates = duplicateKeys(request);
  const owned = await ownedCvIds(
    env,
    input.email,
    referencedCvIds(request.facts)
  );
  for (const fact of request.facts) {
    if (duplicates.has(fact.key)) {
      state.results.push({
        key: fact.key,
        status: "invalid",
        error: "This key appears more than once in the request.",
      });
      continue;
    }
    const next = resolveFact(fact, owned);
    if ("error" in next) {
      state.results.push({
        key: fact.key,
        status: "invalid",
        error: next.error,
      });
      continue;
    }
    planFact(db, scope, state, fact, next);
  }
  for (const key of request.delete_keys ?? []) {
    if (duplicates.has(key)) {
      state.results.push({
        key,
        status: "invalid",
        error: "This key appears more than once in the request.",
      });
      continue;
    }
    planDelete(db, scope, state, key);
  }
  const mirror = await planSettingsMirror(db, scope, state);
  return {
    changed: state.changed,
    facts: [...state.byKey.values()].sort((a, b) =>
      a.key < b.key ? -1 : Number(a.key > b.key)
    ),
    results: state.results,
    statements: [...state.statements, ...mirror.statements],
    timezoneChanged: mirror.timezoneChanged,
  };
}
