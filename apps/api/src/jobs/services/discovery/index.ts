// The discovery service's cross-area entry points (PLAN C5) and the tracked
// job routes of 05 §4:
//
//   addUserJob        `POST /api/v1/user-jobs` — a manual add, either
//                     `{url}` (a private `custom_url` stub posting the CLI or
//                     web enriches later; the server never fetches it, 11
//                     T-08) or full posting fields (`source_kind = manual`)
//   getUserJobDetail  `GET /api/v1/user-jobs/{ujb_id}` — the tracked job, its
//                     posting, the latest score and the application if any
//
// Both postings are private (owner = the caller, 03 §4.1). An excluded host
// (LinkedIn, Indeed) can still be tracked by hand with title + company, but
// never as a `{url}` stub (the CLI would fetch it, D-17) — and its
// `application_support` is `prohibited`.

import { getAdapterManifest } from "@pilihpendidikan/jobs-contracts/adapters";
import type {
  AddUserJobRequest,
  UserJobDetail,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  asciiHost,
  canonicalUrl,
  contentHash,
  dedupeGroup,
  fingerprint,
  primaryLocation,
  registrableDomain,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  JobPostingRecord,
  UserJobRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import { apiError, invalidRequest, notFound } from "../../core/http";
import { getProfileVersion } from "../../repo/core/profile-version";
import { enqueueScoring } from "../../repo/core/score-queue";
import {
  applicationForUserJob,
  getUserJob,
  getUserJobByPosting,
  latestScore,
} from "../../repo/discovery/inbox";
import type { PostingValues } from "../../repo/discovery/postings";
import {
  findPostingsByFingerprint,
  getLinkedPosting,
  getOwnedPrivatePosting,
  insertPostingStatement,
  insertUserJobStatements,
} from "../../repo/discovery/postings";
import { changeLogRows } from "../../repo/discovery/sql";
import { commitPlanned } from "./commit";
import type { DiscoveryContext } from "./context";
import {
  checkUrl,
  domainOfUrl,
  excludedHostOf,
  findForbiddenString,
  FORBIDDEN_TEXT,
  truncateUtf8,
  urlProblemMessage,
} from "./validation";
import { toScoreSummary } from "./views";

/** Inbox state of a manual add: the user has seen what they added. */
export const MANUAL_INBOX_STATE = "seen";
const TITLE_MAX = 300;

type UrlRequest = Extract<AddUserJobRequest, { url: string }>;
type ManualRequest = Exclude<AddUserJobRequest, UrlRequest>;

function isUrlRequest(body: AddUserJobRequest): body is UrlRequest {
  return "url" in body;
}

function assertUrl(value: string, field: string): void {
  const problem = checkUrl(value, { allowHttp: true });
  if (problem) {
    throw invalidRequest(`${field}: ${urlProblemMessage(problem)}`);
  }
}

type PostingDraft = Omit<
  PostingValues,
  | "closed_at"
  | "content_hash"
  | "created_at"
  | "dedupe_group"
  | "fingerprint"
  | "first_seen_at"
  | "last_checked_at"
  | "last_seen_at"
  | "missed_runs"
  | "revision"
  | "status"
  | "updated_at"
>;

async function finishPosting(
  draft: PostingDraft,
  now: number
): Promise<PostingValues> {
  return {
    ...draft,
    fingerprint: await fingerprint({
      source_kind: draft.source_kind,
      source_org: draft.source_org,
      source_job_ref: draft.source_job_ref,
      title: draft.title,
      company_domain: draft.company_domain,
      location_primary: primaryLocation(draft.locations),
      apply_url: draft.apply_url,
      canonical_url: draft.canonical_url,
    }),
    content_hash: await contentHash(draft.title, draft.description_text),
    dedupe_group: await dedupeGroup({
      company_domain: draft.company_domain,
      title: draft.title,
      location_primary: primaryLocation(draft.locations),
    }),
    first_seen_at: now,
    last_seen_at: now,
    last_checked_at: null,
    status: "open",
    closed_at: null,
    missed_runs: 0,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

function urlStub(body: UrlRequest, userId: string): PostingDraft {
  assertUrl(body.url, "url");
  const excluded = excludedHostOf(body.url);
  if (excluded) {
    throw apiError(
      "unsupported_source",
      `${excluded} URLs cannot be added for fetching (D-17). Add the job by hand with its title and company instead.`,
      { details: { excluded } }
    );
  }
  const canonical = canonicalUrl(body.url) ?? body.url;
  const host = asciiHost(body.url) ?? "";
  return {
    visibility: "private",
    owner_user_id: userId,
    source_kind: "custom_url",
    source_org: null,
    source_job_ref: null,
    canonical_url: canonical,
    apply_url: body.url,
    apply_domain: domainOfUrl(body.url),
    company_name: registrableDomain(host) ?? host,
    company_domain: null,
    // A placeholder until the CLI or web enriches the stub.
    title: canonical.replace(SCHEME_RE, "").slice(0, TITLE_MAX),
    department: null,
    locations: [],
    workplace_type: "unknown",
    employment_type: "unknown",
    seniority: null,
    salary: null,
    description_text: "",
    description_truncated: false,
    requirements: [],
    posted_at: null,
    extraction: {},
    application_support:
      getAdapterManifest("custom_url").capabilities.application_support,
  };
}
const SCHEME_RE = /^https?:\/\//;

function manualPosting(body: ManualRequest, userId: string): PostingDraft {
  for (const field of ["apply_url", "canonical_url"] as const) {
    const value = body[field];
    if (value) {
      assertUrl(value, field);
    }
  }
  const description = truncateUtf8(body.description_text ?? "");
  return {
    visibility: "private",
    owner_user_id: userId,
    source_kind: "manual",
    source_org: null,
    source_job_ref: null,
    canonical_url: body.canonical_url ? canonicalUrl(body.canonical_url) : null,
    apply_url: body.apply_url ?? null,
    apply_domain: domainOfUrl(body.apply_url),
    company_name: body.company_name,
    company_domain: body.company_domain ?? null,
    title: body.title,
    department: body.department ?? null,
    locations: body.locations ?? [],
    workplace_type: body.workplace_type ?? "unknown",
    employment_type: body.employment_type ?? "unknown",
    seniority: body.seniority ?? null,
    salary: body.salary ?? null,
    description_text: description.text,
    description_truncated: description.truncated,
    requirements: body.requirements ?? [],
    posted_at: body.posted_at ?? null,
    extraction: {},
    // Hand-tracking an excluded site is allowed, applying by automation not.
    application_support: excludedHostOf(body.apply_url)
      ? "prohibited"
      : "unknown",
  };
}

/** `POST /api/v1/user-jobs` (201; 200 when the same job is already linked). */
export async function addUserJob(
  c: DiscoveryContext,
  body: AddUserJobRequest
): Promise<Response> {
  if (findForbiddenString(body) !== null) {
    throw invalidRequest(`The job contains ${FORBIDDEN_TEXT}.`);
  }
  const draft = isUrlRequest(body)
    ? urlStub(body, c.scope.userId)
    : manualPosting(body, c.scope.userId);
  const values = await finishPosting(draft, c.now);
  const { extra, response } = await commitPlanned(c, async () => {
    const stored = (
      await findPostingsByFingerprint(c.db, c.scope, [values.fingerprint])
    ).get(`private|${values.fingerprint}`);
    const postingId = stored?.id ?? newId("pst", c.now);
    const link = stored
      ? await getUserJobByPosting(c.db, c.scope, stored.id)
      : null;
    if (link && stored) {
      const posting = await getLinkedPosting(c.db, c.scope, stored.id);
      return {
        status: 200,
        body: { user_job: link, posting },
        statements: [],
        extra: null,
      };
    }
    const userJob: UserJobRecord = {
      id: newId("ujb", c.now),
      user_id: c.scope.userId,
      posting_id: postingId,
      origin: "manual",
      inbox_state: MANUAL_INBOX_STATE,
      first_run_id: null,
      source_id: null,
      user_notes: body.user_notes ?? "",
      revision: 1,
      created_at: c.now,
      updated_at: c.now,
    };
    const posting: JobPostingRecord = stored
      ? ((await getOwnedPrivatePosting(c.db, c.scope, stored.id)) ?? {
          ...values,
          id: postingId,
        })
      : { ...values, id: postingId };
    const statements = [
      ...(stored ? [] : [insertPostingStatement(c.db, postingId, values)]),
      ...insertUserJobStatements(
        c.db,
        c.scope,
        [
          {
            id: userJob.id,
            postingId,
            origin: "manual",
            inboxState: MANUAL_INBOX_STATE,
            firstRunId: null,
            sourceId: null,
            userNotes: userJob.user_notes,
          },
        ],
        c.now
      ),
      ...changeLogRows(
        c.db,
        c.scope,
        [
          {
            entity: "posting",
            entityId: postingId,
            revision: posting.revision,
          },
          { entity: "user_job", entityId: userJob.id, revision: 1 },
        ],
        c.now
      ),
    ];
    return {
      status: 201,
      body: { user_job: userJob, posting },
      statements,
      extra: postingId,
    };
  });
  if (extra) {
    await scoreNewJob(c, extra);
  }
  return response;
}

async function scoreNewJob(
  c: DiscoveryContext,
  postingId: string
): Promise<void> {
  try {
    const profileVersion = await getProfileVersion(c.env, c.db, c.scope, c, {
      email: c.caller.email,
    });
    await enqueueScoring(c.env, c.db, c.scope, {
      postingIds: [postingId],
      profileVersion,
      now: c.now,
    });
  } catch (err) {
    console.warn({
      evt: "user_job_score_enqueue_failed",
      request_id: c.requestId,
      error: err instanceof Error ? err.name : String(err),
    });
  }
}

/** `GET /api/v1/user-jobs/{ujb_id}`. */
export async function getUserJobDetail(
  c: DiscoveryContext,
  userJobId: string
): Promise<UserJobDetail> {
  const userJob = await getUserJob(c.db, c.scope, userJobId);
  if (!userJob) {
    throw notFound("Tracked job not found.");
  }
  const posting = await getLinkedPosting(c.db, c.scope, userJob.posting_id);
  if (!posting) {
    throw notFound("Tracked job not found.");
  }
  const profileVersion = await getProfileVersion(c.env, c.db, c.scope, c, {
    email: c.caller.email,
  });
  const score = await latestScore(c.db, c.scope, posting.id, {
    profileVersion,
    rubricVersion: RUBRIC_VERSION,
  });
  return {
    user_job: userJob,
    posting,
    score: score ? toScoreSummary(score) : null,
    application: await applicationForUserJob(c.db, c.scope, userJob.id),
  };
}
