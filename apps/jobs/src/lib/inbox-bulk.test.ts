import type { InboxBulkRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { InboxState } from "@pilihpendidikan/jobs-contracts/enums";
import { describe, expect, it } from "vitest";
import { getT } from "@/i18n";
import { ApiError } from "./api-client";
import type { BulkSender } from "./inbox-bulk";
import {
  bulkFailedOutright,
  bulkToastText,
  chunk,
  INBOX_BULK_MAX,
  runInboxBulk,
  summarizeInboxBulk,
  TRACK_BULK_MAX,
} from "./inbox-bulk";

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `ujb_${index}`);

function recordingSender(): {
  calls: { body: InboxBulkRequest; key: string }[];
  send: BulkSender;
} {
  const calls: { body: InboxBulkRequest; key: string }[] = [];
  return {
    calls,
    send: (body, key) => {
      calls.push({ body, key });
      return Promise.resolve({
        results: body.user_job_ids.map((id) => ({
          user_job_id: id,
          status: "ok" as const,
          inbox_state: "dismissed" as const,
        })),
      });
    },
  };
}

let keyCounter = 0;
const nextKey = () => {
  keyCounter += 1;
  return `web:key-${keyCounter}`;
};

describe("TW-INBOX bulk actions (12 §4, 05 §4 inbox:bulk)", () => {
  it("TW-INBOX sends at most 200 ids per call (100 for track) with one Idempotency-Key per chunk", async () => {
    expect(chunk(ids(5), 2).map((part) => part.length)).toEqual([2, 2, 1]);
    const dismiss = recordingSender();
    const results = await runInboxBulk(
      "dismiss",
      ids(450),
      dismiss.send,
      nextKey
    );
    expect(dismiss.calls.map((call) => call.body.user_job_ids.length)).toEqual([
      INBOX_BULK_MAX,
      INBOX_BULK_MAX,
      50,
    ]);
    expect(new Set(dismiss.calls.map((call) => call.key)).size).toBe(3);
    expect(results).toHaveLength(450);

    const track = recordingSender();
    await runInboxBulk("track", ids(250), track.send, nextKey);
    expect(track.calls.map((call) => call.body.user_job_ids.length)).toEqual([
      TRACK_BULK_MAX,
      TRACK_BULK_MAX,
      50,
    ]);
    expect(track.calls.every((call) => call.body.action === "track")).toBe(
      true
    );
  });

  it("TW-INBOX drops duplicate ids, retries a transient failure with the same key, and marks a dead chunk failed", async () => {
    const keys: string[] = [];
    let attempts = 0;
    const flaky: BulkSender = (body, key) => {
      keys.push(key);
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(
          new ApiError({
            ok: false,
            status: 503,
            error: { error: "upstream_unavailable", message: "busy" },
          })
        );
      }
      return Promise.resolve({
        results: body.user_job_ids.map((id) => ({
          user_job_id: id,
          status: "ok" as const,
          score_status: "queued" as const,
        })),
      });
    };
    const results = await runInboxBulk(
      "score",
      ["a", "b", "a"],
      flaky,
      nextKey
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(results.map((result) => result.user_job_id)).toEqual(["a", "b"]);

    const refused: BulkSender = () =>
      Promise.reject(
        new ApiError({
          ok: false,
          status: 400,
          error: { error: "invalid_request", message: "bad" },
        })
      );
    const failed = await runInboxBulk("seen", ["x", "y"], refused, nextKey);
    expect(failed.map((result) => result.status)).toEqual(["failed", "failed"]);
  });

  it("TW-INBOX summarises per-id results into one toast: Tracked 3 · 1 already tracked", () => {
    const previous = new Map<string, InboxState>([
      ["a", "new"],
      ["b", "new"],
      ["c", "seen"],
      ["d", "tracked"],
      ["e", "new"],
    ]);
    const summary = summarizeInboxBulk(
      "track",
      [
        { user_job_id: "a", status: "ok", application_id: "app_a" },
        { user_job_id: "b", status: "ok", application_id: "app_b" },
        { user_job_id: "c", status: "ok", application_id: "app_c" },
        { user_job_id: "d", status: "ok", application_id: "app_d" },
        { user_job_id: "e", status: "not_found" },
      ],
      previous
    );
    expect(summary).toMatchObject({ done: 3, already: 1, failed: 1 });
    expect(summary.applicationIds).toEqual([
      "app_a",
      "app_b",
      "app_c",
      "app_d",
    ]);
    const t = getT("en");
    expect(bulkToastText(t, summary)).toBe(
      "Tracked 3 · 1 already tracked · 1 failed"
    );
    expect(bulkToastText(getT("id"), summary)).toBe(
      "3 dilacak · 1 sudah dilacak · 1 gagal"
    );

    const dismissed = summarizeInboxBulk(
      "dismiss",
      [
        { user_job_id: "a", status: "ok", inbox_state: "dismissed" },
        { user_job_id: "d", status: "conflict", inbox_state: "tracked" },
      ],
      previous
    );
    expect(bulkToastText(t, dismissed)).toBe(
      "Dismissed 1 · 1 tracked, not dismissed"
    );
    const scored = summarizeInboxBulk(
      "score",
      [
        { user_job_id: "a", status: "ok", score_status: "queued" },
        { user_job_id: "b", status: "ok", score_status: "cached" },
      ],
      previous
    );
    expect(bulkToastText(t, scored)).toBe("Scoring 1 · 1 already scored");
    const nothing = summarizeInboxBulk(
      "seen",
      [{ user_job_id: "z", status: "not_found" }],
      previous
    );
    expect(bulkFailedOutright(nothing)).toBe(true);
    expect(bulkToastText(t, nothing)).toBe("1 failed");
  });

  it("TW-INBOX restore counts dismissed rows as restored and every other state as already there", () => {
    const previous = new Map<string, InboxState>([
      ["a", "dismissed"],
      ["b", "dismissed"],
      ["c", "seen"],
      ["d", "tracked"],
    ]);
    const summary = summarizeInboxBulk(
      "restore",
      [
        { user_job_id: "a", status: "ok", inbox_state: "seen" },
        { user_job_id: "b", status: "ok", inbox_state: "seen" },
        { user_job_id: "c", status: "ok", inbox_state: "seen" },
        { user_job_id: "d", status: "ok", inbox_state: "tracked" },
        { user_job_id: "e", status: "not_found" },
      ],
      previous
    );
    expect(summary).toMatchObject({ done: 2, already: 2, failed: 1 });
    expect(bulkToastText(getT("en"), summary)).toBe(
      "Restored 2 · 2 already in the inbox · 1 failed"
    );
    expect(bulkToastText(getT("id"), summary)).toBe(
      "2 dipulihkan · 2 sudah ada di kotak masuk · 1 gagal"
    );
  });
});
