// Mock api routes for the inbox and found jobs (12 §4–§5, 05 §4, §6):
// `GET /api/v1/inbox` (state, min_score, source, q, cursor paging),
// `POST /api/v1/inbox:bulk` (track puts a card in Saved on the board),
// `GET /api/v1/user-jobs/{ujb_id}` and `GET /api/v1/scores/{posting_id}`.
// Sources and discovery runs are served by scripts/mock/sources.ts.

import type {
  InboxBulkResponse,
  InboxItem,
} from "@pilihpendidikan/jobs-contracts/api";
import type { InboxBulkAction } from "@pilihpendidikan/jobs-contracts/enums";
import { INBOX_BULK_ACTIONS } from "@pilihpendidikan/jobs-contracts/enums";
import { DAY, makeCard, NOW } from "../../src/test/fixtures";
import type { InboxItemSpec } from "../../src/test/fixtures-rest";
import { makeInboxItem, makeScoreRecord } from "../../src/test/fixtures-rest";
import { applicationOf, bumpBoard, cards, fresh, state } from "./state";
import type { MockRequest, MockRoute, Reply } from "./types";
import { apiError, match, NOT_FOUND, ok } from "./types";

const HOUR = 3_600_000;
const BULK_MAX = 200;
const PAGE_DEFAULT = 50;

interface Seed extends InboxItemSpec {
  aiOff?: boolean;
  blocker?: string;
  postedDaysAgo?: number;
  workplace?: "onsite" | "hybrid" | "remote";
}

const SEEDS: Seed[] = [
  {
    title: "Senior Frontend Engineer",
    company: "Acme",
    location: "Remote (APAC)",
    workplace: "remote",
    sourceKind: "greenhouse",
    sourceLabel: "Acme on Greenhouse",
    score: 91,
    duplicates: 1,
    seenAgoHours: 2,
    postedDaysAgo: 2,
  },
  {
    title: "iOS Engineer",
    company: "Blibli",
    location: "Remote (Indonesia)",
    workplace: "remote",
    sourceKind: "greenhouse",
    score: 86,
    seenAgoHours: 3,
    postedDaysAgo: 1,
  },
  {
    title: "Backend Engineer (Go)",
    company: "Xendit",
    location: "Remote (Indonesia)",
    workplace: "remote",
    sourceKind: "greenhouse",
    score: 88,
    seenAgoHours: 5,
    postedDaysAgo: 4,
  },
  {
    title: "Software Engineer, Payments",
    company: "Tokopedia",
    location: "Jakarta",
    workplace: "hybrid",
    sourceKind: "lever",
    score: 84,
    seenAgoHours: 6,
    postedDaysAgo: 3,
  },
  {
    title: "Product Designer",
    company: "Gojek",
    location: "Jakarta",
    workplace: "hybrid",
    sourceKind: "ashby",
    score: 77,
    seenAgoHours: 8,
    postedDaysAgo: 6,
  },
  {
    title: "DevOps Engineer",
    company: "Halodoc",
    location: "Remote",
    workplace: "remote",
    sourceKind: "lever",
    score: 73,
    seenAgoHours: 9,
    postedDaysAgo: 5,
  },
  {
    title: "Data Engineer",
    company: "DANA",
    location: "Jakarta",
    workplace: "onsite",
    sourceKind: "lever",
    score: 71,
    seenAgoHours: 10,
    postedDaysAgo: 8,
  },
  {
    title: "Machine Learning Engineer",
    company: "Grab",
    location: "Singapore",
    workplace: "onsite",
    sourceKind: "greenhouse",
    score: 69,
    blocker: "⚠ Possible blocker: on-site in Singapore, outside your locations",
    seenAgoHours: 12,
    postedDaysAgo: 9,
  },
  {
    title: "Engineering Manager",
    company: "Kopi Kenangan",
    location: "Jakarta",
    workplace: "onsite",
    sourceKind: "custom_url",
    score: 66,
    aiOff: true,
    runId: null,
    seenAgoHours: 20,
    postedDaysAgo: 12,
  },
  {
    title: "QA Automation Engineer",
    company: "Bukalapak",
    location: "Bandung",
    workplace: "hybrid",
    sourceKind: "smartrecruiters",
    score: 58,
    seenAgoHours: 22,
    postedDaysAgo: 14,
  },
  {
    title: "Site Reliability Engineer",
    company: "Shopee",
    location: "Singapore",
    workplace: "onsite",
    sourceKind: "workday",
    score: 55,
    seenAgoHours: 30,
    postedDaysAgo: 20,
  },
  {
    title: "Mobile Engineer (Android)",
    company: "Traveloka",
    location: "Jakarta",
    workplace: "hybrid",
    sourceKind: "workable",
    score: "queued",
    seenAgoHours: 1,
    postedDaysAgo: 1,
  },
  {
    title: "Data Analyst",
    company: "Globex",
    location: "Jakarta",
    workplace: "onsite",
    sourceKind: "career_page",
    sourceLabel: "Globex careers",
    score: null,
    duplicates: 1,
    seenAgoHours: 26,
    postedDaysAgo: 7,
  },
  {
    title: "Frontend Developer",
    company: "Ruangguru",
    location: "Jakarta",
    workplace: "hybrid",
    sourceKind: "career_page",
    score: 81,
    inboxState: "seen",
    seenAgoHours: 40,
    postedDaysAgo: 10,
  },
  {
    title: "Full Stack Engineer",
    company: "eFishery",
    location: "Bandung",
    workplace: "onsite",
    sourceKind: "generic_listing",
    score: 62,
    inboxState: "seen",
    seenAgoHours: 50,
    postedDaysAgo: 16,
  },
  {
    title: "UI Engineer",
    company: "Mekari",
    location: "Yogyakarta",
    workplace: "remote",
    sourceKind: "ashby",
    score: 79,
    inboxState: "dismissed",
    seenAgoHours: 70,
    postedDaysAgo: 18,
  },
];

function seedItem(seed: Seed): InboxItem {
  const posted = NOW - (seed.postedDaysAgo ?? 3) * DAY;
  const item = makeInboxItem({
    ...seed,
    posting: {
      workplace_type: seed.workplace ?? "onsite",
      posted_at: posted,
      ...seed.posting,
    },
  });
  if (item.score && seed.aiOff) {
    item.score = { ...item.score, deterministic_only: true };
  }
  if (item.score && seed.blocker) {
    item.score = {
      ...item.score,
      explanation: `${seed.blocker}\n${item.score.explanation}`,
    };
  }
  if (seed.company === "Acme") {
    // Same job also found on Acme's own careers page (15 §11 alternates).
    item.posting = {
      ...item.posting,
      extraction: {
        ...(item.posting.extraction as InboxItem["posting"]["extraction"] &
          Record<string, unknown>),
        alternates: [
          {
            adapter: "career_page",
            adapter_version: "1.0.0",
            fetch_mode: "static_html",
            method: "json_ld",
            confidence: 0.9,
            observed_at: NOW - 5 * HOUR,
            source_urls: { detail: "https://acme.example/careers/frontend" },
            run_id: null,
          },
        ],
      } as InboxItem["posting"]["extraction"],
    };
  }
  return item;
}

const items = new Map<string, InboxItem>(
  SEEDS.map((seed) => {
    const item = fresh(seedItem(seed));
    return [item.user_job.id, item];
  })
);
/** The board's "Inbox 12" counter follows the mock's New rows. */
function syncNewCount(): void {
  const count = [...items.values()].filter(
    (item) => item.user_job.inbox_state === "new"
  ).length;
  if (state.board.counts.inbox_new !== count) {
    state.board = {
      ...state.board,
      counts: { ...state.board.counts, inbox_new: count },
    };
    bumpBoard();
  }
}

/** user_job id → the application `track` created. */
const trackedApps = new Map<string, string>();

function matchesSource(item: InboxItem, source: string | null): boolean {
  if (!source) {
    return true;
  }
  return source.startsWith("src_")
    ? item.provenance.source_id === source
    : item.posting.source_kind === source;
}

function matchesQuery(item: InboxItem, q: string | null): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    item.posting.title.toLowerCase().includes(needle) ||
    item.posting.company_name.toLowerCase().includes(needle)
  );
}

function listInbox(request: MockRequest): Reply {
  const params = request.url.searchParams;
  const stateFilter = params.get("state");
  const states = stateFilter ? [stateFilter] : ["new", "seen"];
  const minScore = params.get("min_score");
  const min = minScore === null ? null : Number(minScore);
  const limit = Math.min(200, Number(params.get("limit") ?? PAGE_DEFAULT));
  const offset = Number(
    Buffer.from(params.get("cursor") ?? "MA", "base64url").toString("utf8")
  );
  const filtered = [...items.values()]
    .filter((item) => states.includes(item.user_job.inbox_state))
    .filter(
      (item) =>
        min === null ||
        (item.score?.status === "ready" && item.score.score >= min)
    )
    .filter((item) => matchesSource(item, params.get("source")))
    .filter((item) => matchesQuery(item, params.get("q")))
    .sort((a, b) => b.user_job.created_at - a.user_job.created_at);
  const start = Number.isFinite(offset) ? offset : 0;
  const pageItems = filtered.slice(start, start + limit);
  const next = start + limit < filtered.length ? start + limit : null;
  return ok({
    items: pageItems,
    next_cursor:
      next === null ? null : Buffer.from(String(next)).toString("base64url"),
  });
}

function updateItem(
  item: InboxItem,
  inboxState: InboxItem["user_job"]["inbox_state"]
) {
  const next: InboxItem = {
    ...item,
    user_job: {
      ...item.user_job,
      inbox_state: inboxState,
      revision: item.user_job.revision + 1,
      updated_at: Date.now(),
    },
  };
  items.set(item.user_job.id, next);
  return next;
}

/** Puts the job on the board in Saved (top) and returns the application id. */
function trackItem(item: InboxItem): string {
  const known = trackedApps.get(item.user_job.id);
  if (known) {
    return known;
  }
  const card = makeCard(
    {
      company: item.posting.company_name,
      title: item.posting.title,
      stage: "saved",
      location: item.posting.locations[0]?.raw,
      source: item.posting.source_kind,
      score: item.score?.status === "ready" ? item.score.score : null,
      updatedAgoDays: 0,
    },
    0,
    {
      user_job_id: item.user_job.id,
      board_rank: "a0000",
      updated_at: Date.now(),
      stage_changed_at: Date.now(),
    }
  );
  state.board = {
    ...state.board,
    columns: state.board.columns.map((column) =>
      column.stage === "saved"
        ? {
            ...column,
            cards: [card, ...column.cards],
            total: column.total + 1,
          }
        : column
    ),
  };
  bumpBoard();
  trackedApps.set(item.user_job.id, card.id);
  updateItem(item, "tracked");
  return card.id;
}

type BulkResult = InboxBulkResponse["results"][number];

function bulkOne(action: InboxBulkAction, id: string): BulkResult {
  const item = items.get(id);
  if (!item) {
    return { user_job_id: id, status: "not_found" };
  }
  const current = item.user_job.inbox_state;
  switch (action) {
    case "track":
      return {
        user_job_id: id,
        status: "ok",
        inbox_state: "tracked",
        application_id: trackItem(item),
      };
    case "dismiss":
      if (current === "tracked") {
        return {
          user_job_id: id,
          status: "conflict",
          inbox_state: "tracked",
          error:
            "This job is tracked; archive its application on the board instead.",
        };
      }
      return {
        user_job_id: id,
        status: "ok",
        inbox_state: updateItem(item, "dismissed").user_job.inbox_state,
      };
    case "restore":
      return {
        user_job_id: id,
        status: "ok",
        inbox_state:
          current === "dismissed"
            ? updateItem(item, "seen").user_job.inbox_state
            : current,
      };
    case "seen":
      return {
        user_job_id: id,
        status: "ok",
        inbox_state:
          current === "new"
            ? updateItem(item, "seen").user_job.inbox_state
            : current,
      };
    default: {
      if (item.score?.status === "ready") {
        return { user_job_id: id, status: "ok", score_status: "cached" };
      }
      items.set(id, {
        ...item,
        score: {
          posting_id: item.posting.id,
          score: 0,
          status: "queued",
          confidence: null,
          deterministic_only: false,
          profile_version: 4,
          rubric_version: "r1",
          explanation: "",
          created_at: Date.now(),
        },
      });
      return { user_job_id: id, status: "ok", score_status: "queued" };
    }
  }
}

function inboxBulk(request: MockRequest): Reply {
  const { action, user_job_ids: ids } = request.body as {
    action?: string;
    user_job_ids?: unknown;
  };
  if (
    !(
      (INBOX_BULK_ACTIONS as readonly string[]).includes(String(action)) &&
      Array.isArray(ids)
    ) ||
    ids.length === 0 ||
    ids.length > BULK_MAX
  ) {
    return apiError(400, "invalid_request", "Invalid inbox:bulk request.");
  }
  const results = ids.map((id) =>
    bulkOne(action as InboxBulkAction, String(id))
  );
  syncNewCount();
  return ok({ results });
}

function userJob(id: string): Reply {
  const item = items.get(id);
  if (!item) {
    return NOT_FOUND;
  }
  const appId = trackedApps.get(id);
  const card = appId ? cards().find((entry) => entry.id === appId) : undefined;
  return ok({
    user_job: item.user_job,
    posting: item.posting,
    score: item.score,
    application: card ? applicationOf(card) : null,
  });
}

function scoreOf(postingId: string): Reply {
  const item = [...items.values()].find(
    (entry) => entry.posting.id === postingId
  );
  if (!item) {
    return NOT_FOUND;
  }
  const summary = item.score;
  if (!summary || summary.status !== "ready") {
    return ok({ score: null, profile_version: 4 });
  }
  const record = makeScoreRecord(postingId, {
    score: summary.score,
    explanation: summary.explanation,
    created_at: summary.created_at,
  });
  const components = record.components;
  if ("score" in components && "ai" in components) {
    components.score = summary.score;
    components.base = summary.score / 100;
    if (summary.deterministic_only) {
      components.ai = {
        ...components.ai,
        status: "disabled",
        overall_fit: null,
      };
    }
    if (summary.explanation.startsWith("⚠")) {
      components.gates = [
        {
          predicate: "requires_onsite_outside_user_locations",
          level: "possible",
          probability: 0.64,
          multiplier: 0.85,
        },
      ];
    }
  }
  return ok({ score: record, profile_version: 4 });
}

const USER_JOB_RE = /^\/api\/v1\/user-jobs\/([^/]+)$/;
const SCORE_RE = /^\/api\/v1\/scores\/([^/:]+)$/;

syncNewCount();

export const routes: MockRoute[] = [
  (request) =>
    request.method === "GET" && request.path === "/api/v1/inbox"
      ? listInbox(request)
      : null,
  (request) =>
    request.method === "POST" && request.path === "/api/v1/inbox:bulk"
      ? inboxBulk(request)
      : null,
  (request) => {
    const found = match(request, "GET", USER_JOB_RE);
    return found ? userJob(found[0] ?? "") : null;
  },
  (request) => {
    const found = match(request, "GET", SCORE_RE);
    return found ? scoreOf(found[0] ?? "") : null;
  },
];
