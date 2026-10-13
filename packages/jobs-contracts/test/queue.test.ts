import { describe, expect, test } from "bun:test";
import { newId } from "../src/ids";
import {
  chunkPostingIds,
  JobsAiMessageSchema,
  parseQueueMessage,
  QUEUE_MESSAGE_TYPES,
  queueMessageBytes,
  queueRetryDelaySeconds,
} from "../src/queue";

const T = 1_791_770_000_000;
const user_id = newId("usr", T);
const base = { v: 1, message_id: "msg-1", user_id } as const;

const EXAMPLES = {
  score_postings: {
    ...base,
    type: "score_postings",
    posting_ids: [newId("pst", T), newId("pst", T + 1)],
    profile_version: 12,
    rubric_version: "r1",
  },
  tailor_cv: { ...base, type: "tailor_cv", cv_variant_id: newId("cvv", T) },
  evaluate_rules: {
    ...base,
    type: "evaluate_rules",
    posting_ids: [newId("pst", T)],
  },
  purge_user: { ...base, type: "purge_user", phase: "r2" },
  rollup_user: {
    ...base,
    type: "rollup_user",
    days: ["2026-10-11", "2026-10-12"],
  },
  rebuild_analytics: {
    ...base,
    type: "rebuild_analytics",
    reason: "timezone_change",
  },
  export_user: { ...base, type: "export_user", export_id: "exp_1" },
} as const;

describe("jobs-ai queue contract (14 §6)", () => {
  test("TC-QUEUE the union has exactly the seven message types of 14 §6", () => {
    expect<string[]>([...QUEUE_MESSAGE_TYPES].sort()).toEqual(
      Object.keys(EXAMPLES).sort()
    );
  });

  test.each(
    Object.entries(EXAMPLES).map(([type, message]) => [type, message] as const)
  )("TC-QUEUE %s parses and round-trips", (_type, message) => {
    const parsed = parseQueueMessage(message);
    expect(parsed).toEqual(message as never);
    expect(
      JobsAiMessageSchema.parse(JSON.parse(JSON.stringify(parsed)))
    ).toEqual(parsed);
    expect(queueMessageBytes(parsed)).toBeLessThan(8192);
  });

  test("TC-QUEUE envelope is versioned and typed", () => {
    expect(
      JobsAiMessageSchema.safeParse({ ...EXAMPLES.tailor_cv, v: 2 }).success
    ).toBe(false);
    expect(
      JobsAiMessageSchema.safeParse({
        ...EXAMPLES.tailor_cv,
        type: "send_email",
      }).success
    ).toBe(false);
    expect(
      JobsAiMessageSchema.safeParse({
        ...EXAMPLES.purge_user,
        phase: "everything",
      }).success
    ).toBe(false);
    expect(
      JobsAiMessageSchema.safeParse({
        ...EXAMPLES.rebuild_analytics,
        reason: "manual",
      }).success
    ).toBe(false);
    expect(
      JobsAiMessageSchema.safeParse({
        ...EXAMPLES.tailor_cv,
        user_id: "rahma@example.com",
      }).success
    ).toBe(false);
  });

  test("TC-QUEUE score_postings carries at most 50 postings, one user per message", () => {
    const many = Array.from({ length: 51 }, (_, i) => newId("pst", T + i));
    expect(
      JobsAiMessageSchema.safeParse({
        ...EXAMPLES.score_postings,
        posting_ids: many,
      }).success
    ).toBe(false);
    expect(chunkPostingIds(many).map((chunk) => chunk.length)).toEqual([50, 1]);
    expect(chunkPostingIds([])).toEqual([]);
  });

  test("TC-QUEUE retry delay is min(300, 2^attempt * 10 + jitter)", () => {
    expect(queueRetryDelaySeconds(1, () => 0)).toBe(20);
    expect(queueRetryDelaySeconds(3, () => 0.5)).toBe(85);
    expect(queueRetryDelaySeconds(10, () => 0.99)).toBe(300);
  });

  test("TC-QUEUE parseQueueMessage refuses invalid messages before sending", () => {
    expect(() =>
      parseQueueMessage({ ...EXAMPLES.export_user, export_id: "x".repeat(65) })
    ).toThrow();
    expect(() =>
      parseQueueMessage({ ...EXAMPLES.rollup_user, days: [] })
    ).toThrow();
    // The largest valid message still fits the 8 KB budget.
    const days = Array.from({ length: 400 }, () => "2026-10-12");
    expect(
      queueMessageBytes(parseQueueMessage({ ...EXAMPLES.rollup_user, days }))
    ).toBeLessThan(8192);
  });
});
