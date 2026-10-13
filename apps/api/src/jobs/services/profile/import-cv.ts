// `POST /api/v1/profile/facts:import-cv` (05 §10, 03 §9, 12 §9): derives fact
// proposals from one of the caller's base CVs for the user to review. Nothing
// is written; the web/CLI sends the accepted proposals back through
// `PUT /api/v1/profile/facts` (source `cv_import`).
//
// Proposals (each validated against its key's schema, invalid ones dropped):
//   contact.full_name / first_name / last_name / email / phone / location
//   links.linkedin  (the builder stores a LinkedIn handle, not a URL)
//   links.github    (a github.com profile found in project / experience links)
//   education[<entry id>] / experience[<entry id>]   references, never copies
//   profile.primary_cv_id
//
// The CV must carry the caller's owner stamp (no admin bypass, D-26 spirit);
// anything else is "not found".

import type { ImportCvFactsResponse } from "@pilihpendidikan/jobs-contracts/api";
import { validateFactValue } from "@pilihpendidikan/jobs-contracts/facts";
import type { ApplicantFactRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { factsByKeys } from "../../repo/profile/facts";
import { PRIMARY_CV_KEY } from "./facts";
import { ownedCvIds } from "./shared";

type Proposal = ImportCvFactsResponse["proposals"][number];

interface CvEntry {
  id?: unknown;
  url?: unknown;
}

interface CvDocumentShape {
  education?: CvEntry[];
  experience?: CvEntry[];
  personalInfo?: Record<string, unknown>;
  projects?: CvEntry[];
}

const WHITESPACE_RE = /\s+/;
const URL_SCHEME_RE = /^https?:\/\//i;
const LINKEDIN_HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/;
const LINKEDIN_PATH_RE = /^\/?(?:in\/)?([A-Za-z0-9][A-Za-z0-9_-]{1,99})\/?$/;
const GITHUB_USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ENTRY_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const GITHUB_RESERVED = new Set([
  "about",
  "orgs",
  "topics",
  "features",
  "marketplace",
  "settings",
  "sponsors",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function withScheme(url: string): string {
  return URL_SCHEME_RE.test(url) ? url : `https://${url}`;
}

/** LinkedIn handle (or pasted profile URL) → profile URL. */
export function linkedInUrl(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }
  if (LINKEDIN_HANDLE_RE.test(value)) {
    return `https://www.linkedin.com/in/${value}`;
  }
  try {
    const url = new URL(withScheme(value));
    if (!url.hostname.toLowerCase().endsWith("linkedin.com")) {
      return null;
    }
    const match = LINKEDIN_PATH_RE.exec(url.pathname);
    return match ? `https://www.linkedin.com/in/${match[1]}` : null;
  } catch {
    return null;
  }
}

/** The first github.com profile among entry links, as a profile URL. */
export function githubProfile(entries: readonly CvEntry[]): string | null {
  for (const entry of entries) {
    const raw = text(entry.url);
    if (raw.length === 0) {
      continue;
    }
    try {
      const url = new URL(withScheme(raw));
      const host = url.hostname.toLowerCase();
      if (host !== "github.com" && host !== "www.github.com") {
        continue;
      }
      const user = url.pathname.split("/").find(Boolean) ?? "";
      if (
        GITHUB_USER_RE.test(user) &&
        !GITHUB_RESERVED.has(user.toLowerCase())
      ) {
        return `https://github.com/${user}`;
      }
    } catch {
      // not a URL
    }
  }
  return null;
}

function entryIds(entries: readonly CvEntry[] | undefined): string[] {
  return (entries ?? [])
    .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
    .filter((id) => ENTRY_ID_RE.test(id));
}

function nameParts(fullName: string): { first: string; last: string } {
  const parts = fullName.split(WHITESPACE_RE).filter(Boolean);
  if (parts.length < 2) {
    return { first: parts[0] ?? "", last: "" };
  }
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Candidate `[key, value, cv_entry_id]` triples of a CV document. */
export function deriveCvFacts(
  cvId: string,
  doc: CvDocumentShape
): Array<{ cvEntryId: string | null; key: string; value: unknown }> {
  const info = doc.personalInfo ?? {};
  const fullName = text(info.fullName);
  const { first, last } = nameParts(fullName);
  const out: Array<{ cvEntryId: string | null; key: string; value: unknown }> =
    [
      { key: "contact.full_name", value: fullName, cvEntryId: null },
      { key: "contact.first_name", value: first, cvEntryId: null },
      { key: "contact.last_name", value: last, cvEntryId: null },
      { key: "contact.email", value: text(info.email), cvEntryId: null },
      { key: "contact.phone", value: text(info.phone), cvEntryId: null },
      { key: "contact.location", value: text(info.location), cvEntryId: null },
      {
        key: "links.linkedin",
        value: linkedInUrl(text(info.linkedIn)),
        cvEntryId: null,
      },
      {
        key: "links.github",
        value: githubProfile([
          ...(doc.projects ?? []),
          ...(doc.experience ?? []),
        ]),
        cvEntryId: null,
      },
    ];
  for (const section of ["education", "experience"] as const) {
    for (const entryId of entryIds(doc[section])) {
      out.push({
        key: `${section}[${entryId}]`,
        value: { cv_id: cvId, cv_entry_id: entryId },
        cvEntryId: entryId,
      });
    }
  }
  out.push({ key: PRIMARY_CV_KEY, value: cvId, cvEntryId: null });
  return out.filter(
    (candidate) =>
      candidate.value !== null &&
      candidate.value !== "" &&
      validateFactValue(candidate.key, candidate.value).ok
  );
}

/** Proposals for `cvId`, each with the current fact of its key. */
export async function importCvProposals(
  env: Pick<Env, "CV_KV">,
  db: JobsDb,
  scope: UserScope,
  input: { cvId: string; email: string }
): Promise<ImportCvFactsResponse> {
  const owned = await ownedCvIds(env, input.email, [input.cvId]);
  if (!owned.has(input.cvId)) {
    throw notFound("CV not found.");
  }
  const doc = await env.CV_KV.get<CvDocumentShape>(`cv:${input.cvId}`, "json");
  if (!doc || typeof doc !== "object") {
    throw notFound("CV not found.");
  }
  const candidates = deriveCvFacts(input.cvId, doc);
  const current = await factsByKeys(
    db,
    scope,
    candidates.map((c) => c.key)
  );
  const proposals: Proposal[] = candidates.map((candidate) => ({
    key: candidate.key,
    value: candidate.value as Proposal["value"],
    source: "cv_import",
    cv_id: input.cvId,
    cv_entry_id: candidate.cvEntryId,
    current: (current.get(candidate.key) ?? null) as ApplicantFactRecord | null,
  }));
  return { proposals };
}
