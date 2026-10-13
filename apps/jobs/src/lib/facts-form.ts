// The Facts form (12 §9) over the canonical keys of 03 §9: which keys appear
// in which group, how a value is edited as text, and the PUT of what changed
// (per-fact base_revision, 05 §10). Values are validated with the contracts'
// `validateFactValue` before anything is sent.

import type { PutFactsRequest } from "@pilihpendidikan/jobs-contracts/api";
import { validateFactValue } from "@pilihpendidikan/jobs-contracts/facts";
import type { ApplicantFactRecord } from "@pilihpendidikan/jobs-contracts/records";

export type FactInput = "text" | "email" | "tel" | "url" | "list" | "boolean";

export interface FactFieldDef {
  input: FactInput;
  key: string;
}

export interface FactGroupDef {
  fields: readonly FactFieldDef[];
  /** i18n key under `profile.groups.` */
  id: string;
}

export const FACT_GROUPS: readonly FactGroupDef[] = [
  {
    id: "contact",
    fields: [
      { key: "contact.full_name", input: "text" },
      { key: "contact.first_name", input: "text" },
      { key: "contact.last_name", input: "text" },
      { key: "contact.email", input: "email" },
      { key: "contact.phone", input: "tel" },
      { key: "contact.location", input: "text" },
      { key: "contact.country", input: "text" },
    ],
  },
  {
    id: "links",
    fields: [
      { key: "links.linkedin", input: "url" },
      { key: "links.github", input: "url" },
      { key: "links.portfolio", input: "url" },
      { key: "links.website", input: "url" },
    ],
  },
  {
    id: "preferences",
    fields: [
      { key: "prefs.target_titles", input: "list" },
      { key: "skills.extra", input: "list" },
      { key: "prefs.timezone", input: "text" },
      { key: "eligibility.age_18_plus", input: "boolean" },
    ],
  },
];

/** The text an input shows for a stored value. */
export function factText(value: unknown, input: FactInput): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (input === "list") {
    return Array.isArray(value) ? value.join(", ") : "";
  }
  if (input === "boolean") {
    return value === true ? "true" : "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The value for an input's text; null means "no fact" (delete it). */
export function factValue(text: string, input: FactInput): unknown {
  const trimmed = text.trim();
  if (input === "list") {
    const items = trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  if (input === "boolean") {
    return trimmed === "true" ? true : null;
  }
  return trimmed === "" ? null : trimmed;
}

export interface FactEdit {
  key: string;
  /** null deletes the fact. */
  value: unknown;
}

export type FactsPlan =
  | { ok: true; request: PutFactsRequest; changed: number }
  | { ok: false; errors: Record<string, string> };

/**
 * The `PUT /profile/facts` body for `edits` against the current facts: only
 * changed keys, each with its row's revision as `base_revision`; cleared
 * keys go to `delete_keys`. Invalid values stop the save.
 */
export function planFactsSave(
  current: readonly ApplicantFactRecord[],
  edits: readonly FactEdit[]
): FactsPlan {
  const byKey = new Map(current.map((fact) => [fact.key, fact]));
  const errors: Record<string, string> = {};
  const facts: PutFactsRequest["facts"] = [];
  const deleteKeys: string[] = [];
  for (const edit of edits) {
    const existing = byKey.get(edit.key);
    if (edit.value === null) {
      if (existing) {
        deleteKeys.push(edit.key);
      }
      continue;
    }
    if (
      existing &&
      JSON.stringify(existing.value) === JSON.stringify(edit.value)
    ) {
      continue;
    }
    const valid = validateFactValue(edit.key, edit.value);
    if (!valid.ok) {
      errors[edit.key] = valid.error;
      continue;
    }
    facts.push({
      key: edit.key,
      value: edit.value as PutFactsRequest["facts"][number]["value"],
      source: "user_entered",
      ...(existing ? { base_revision: existing.revision } : {}),
    });
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    changed: facts.length + deleteKeys.length,
    request: {
      facts,
      ...(deleteKeys.length > 0 ? { delete_keys: deleteKeys } : {}),
    },
  };
}

const PROTECTED_QUESTION_RE =
  /(gender|sex\b|race|ethnic|disab|veteran|sexual|orientation|criminal|conviction|\bage\b|birth|religio|health|union|visa|citizen|sponsor|work_auth)/i;

/**
 * Screening questions that are protected (03 §9): the editor preselects the
 * `protected` sensitivity for them, and protected answers can never be
 * `auto_use = always`.
 */
export function isProtectedQuestion(questionKey: string): boolean {
  return PROTECTED_QUESTION_RE.test(questionKey);
}
