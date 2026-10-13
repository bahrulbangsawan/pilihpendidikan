// Shared, mutable state of the mock api: the board, the application rows,
// the devices. Area modules (scripts/mock/*.ts) read and change it so a
// "Track" in the inbox shows up on the board, a revoked device disappears
// from the Apply tab, and so on.

import type {
  ApplicationDetail,
  BoardCard,
  BoardResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  DAY,
  makeApplication,
  makeDetail,
  makeDevice,
  makeInterview,
  makeOffer,
  makePosting,
  makeSettings,
  NOW,
  sampleBoard,
} from "../../src/test/fixtures";
import type { DeviceWithReport } from "../../src/test/fixtures-rest";
import { makeDeviceReport } from "../../src/test/fixtures-rest";

/** Fixtures are pinned to NOW; replies shift timestamps to the real clock. */
export const SHIFT = Date.now() - NOW;

const TIMESTAMP_KEY_RE = /(^|_)at$|^(not_before|expires_at|posted_at)$/;
const MIN_EPOCH_MS = 1_500_000_000_000;

/** A deep copy with every epoch-ms `*_at` field moved by SHIFT. */
export function fresh<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => fresh(item)) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] =
      typeof child === "number" &&
      child > MIN_EPOCH_MS &&
      TIMESTAMP_KEY_RE.test(key)
        ? child + SHIFT
        : fresh(child);
  }
  return out as T;
}

export const state = {
  board: fresh(sampleBoard()) as BoardResponse,
  boardVersion: 1,
  settings: makeSettings(),
  applications: new Map<string, ApplicationRecord>(),
  devices: fresh([
    {
      ...makeDevice({ name: "MacBook", active: true }),
      signed_in: true,
      signed_out_reason: null,
      report: makeDeviceReport(),
    },
    {
      ...makeDevice({
        name: "Desktop",
        platform: "windows",
        arch: "x86_64",
        cli_version: "1.0.4",
        online: false,
        last_seen_at: NOW - 3 * DAY,
        capabilities: ["discover", "apply"],
        accepts_tasks: false,
      }),
      signed_in: true,
      signed_out_reason: null,
      report: makeDeviceReport({
        cli_version: "1.0.4",
        last_sync_at: NOW - 3 * DAY,
        outbox_depth: 3,
        outbox_dead: 1,
        outbox_pending_since: NOW - 3 * DAY,
        reported_at: NOW - 3 * DAY,
      }),
    },
  ]) as DeviceWithReport[],
};

export function cards(): BoardCard[] {
  return state.board.columns.flatMap((column) => column.cards);
}

export function bumpBoard(): void {
  state.boardVersion += 1;
}

export function applicationOf(card: BoardCard): ApplicationRecord {
  const existing = state.applications.get(card.id);
  if (existing) {
    return existing;
  }
  const created = card.updated_at - 8 * DAY;
  const record = makeApplication({
    id: card.id,
    user_job_id: card.user_job_id,
    stage: card.stage,
    stage_changed_at: card.stage_changed_at,
    submission_status: card.submission_status,
    submitted_at: card.submission_status.startsWith("submitted")
      ? card.stage_changed_at
      : null,
    submission_method: card.submission_status.startsWith("submitted")
      ? "browser"
      : null,
    mode: card.mode,
    priority: card.priority,
    board_rank: card.board_rank,
    archived: card.archived,
    follow_up_at: card.follow_up_at,
    cv_variant_id: card.cv_variant_id,
    revision: card.revision,
    created_at: created,
    updated_at: card.updated_at,
    sections:
      card.posting.company_name === "Acme"
        ? [
            {
              id: "s1",
              name: "Documents",
              items: [
                {
                  id: "i1",
                  title: "Portfolio link",
                  notes: "",
                  url: "https://rina.example",
                  done: true,
                },
                {
                  id: "i2",
                  title: "Reference letter",
                  notes: "Ask Pak Budi",
                  url: "",
                  done: false,
                },
              ],
            },
          ]
        : [],
  });
  state.applications.set(card.id, record);
  return record;
}

/** Extra timeline events other areas add (task progress, approvals…). */
export const extraEvents: ((card: BoardCard) => unknown[])[] = [];

/** Extra detail parts other areas attach (CV variants, emails, tasks…). */
export const detailExtras: ((
  card: BoardCard,
  detail: ApplicationDetail
) => ApplicationDetail)[] = [];

export function detailOf(card: BoardCard): ApplicationDetail {
  const application = applicationOf(card);
  const posting = fresh(
    makePosting({
      id: card.posting.id,
      title: card.posting.title,
      company_name: card.posting.company_name,
      source_kind: card.posting.source_kind,
      status: card.posting.status,
      closed_at: card.posting.closed_at,
      locations: [{ raw: card.posting.location ?? "Jakarta" }],
    })
  );
  const interviews = ["interviewing", "offer"].includes(card.stage)
    ? [fresh(makeInterview(card.id, { scheduled_at: NOW + 2 * DAY }))]
    : [];
  const offers =
    card.stage === "offer"
      ? [fresh(makeOffer(card.id, { deadline_at: NOW + 5 * DAY }))]
      : [];
  let detail = makeDetail({ application, posting, interviews, offers });
  for (const extra of detailExtras) {
    detail = extra(card, detail);
  }
  return detail;
}

export function cardByCompany(company: string): BoardCard | undefined {
  return cards().find((card) => card.posting.company_name === company);
}

/**
 * `DELETE /api/v1/applications/{id}?purge=1` (06 §11): the card leaves the
 * board for good. Returns false when the base revision is stale.
 */
export function purgeApplication(appId: string, baseRevision: number): boolean {
  const card = cards().find((entry) => entry.id === appId);
  if (!card || applicationOf(card).revision !== baseRevision) {
    return false;
  }
  state.applications.delete(appId);
  state.board = {
    ...state.board,
    columns: state.board.columns.map((column) => {
      const rest = column.cards.filter((entry) => entry.id !== appId);
      return rest.length === column.cards.length
        ? column
        : { ...column, cards: rest, total: rest.length };
    }),
  };
  bumpBoard();
  return true;
}
