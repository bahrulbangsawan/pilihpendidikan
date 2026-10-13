// @vitest-environment happy-dom
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import { ScreeningAnswerRecordSchema } from "@pilihpendidikan/jobs-contracts/records";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  cleanup,
  fakeApi,
  itemByText,
  pointerDown,
  renderWithProviders,
  waitFor,
} from "@/components/cli/test-harness";
import { fixtureId, NOW, USER_ID } from "@/test/fixtures";
import { AnswersTab } from "./answers-tab";

// happy-dom with Radix portals is slow on a loaded machine.
const DOM_TEST_TIMEOUT = 20_000;

const toasts = vi.hoisted(() => ({ calls: [] as [string, string][] }));
vi.mock("sonner", () => {
  const record =
    (kind: string) =>
    (message: string): void => {
      toasts.calls.push([kind, message]);
    };
  return {
    toast: Object.assign(record("default"), {
      success: record("success"),
      warning: record("warning"),
      info: record("info"),
      error: record("error"),
    }),
  };
});

afterEach(() => {
  cleanup();
  toasts.calls.length = 0;
});

function makeAnswer(
  overrides: Partial<ScreeningAnswerRecord>
): ScreeningAnswerRecord {
  return ScreeningAnswerRecordSchema.parse({
    id: fixtureId("ans"),
    user_id: USER_ID,
    question_key: "notice_period",
    match_patterns: [],
    answer: "One month",
    answer_kind: "text",
    sensitivity: "none",
    auto_use: "approval",
    revision: 2,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

async function selectAll() {
  await act(async () => {
    document.querySelector<HTMLElement>("[aria-label='Select all']")?.click();
    await Promise.resolve();
  });
}

describe("TW-PROFILE answers bulk actions (12 §9)", () => {
  it(
    "TW-PROFILE bulk Use it: Always skips protected answers and unchanged ones, PATCHes the rest with base_revision",
    async () => {
      const notice = makeAnswer({ question_key: "notice_period" });
      const visa = makeAnswer({
        question_key: "requires_sponsorship",
        sensitivity: "protected",
      });
      const salary = makeAnswer({
        question_key: "expected_salary",
        auto_use: "always",
        revision: 5,
      });
      const api = fakeApi({
        "GET /api/v1/profile/answers": () => ({
          items: [notice, visa, salary],
          next_cursor: null,
        }),
        "PATCH /api/v1/profile/answers/{ans_id}": (request) => ({
          answer: { ...notice, ...(request.body as object), revision: 3 },
        }),
      });
      renderWithProviders(<AnswersTab />);
      await waitFor(() => {
        expect(document.body.textContent).toContain("requires_sponsorship");
      });
      await selectAll();
      await waitFor(() => {
        expect(document.body.textContent).toContain("3 selected");
      });
      await pointerDown(buttonByText("Use it") ?? null);
      await waitFor(() => {
        expect(itemByText("Always")).toBeDefined();
      });
      expect(itemByText("Always")?.textContent).toContain(
        "1 protected skipped"
      );
      await act(async () => {
        itemByText("Always")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(toasts.calls).toHaveLength(1);
      });
      const patches = api.calls("PATCH /api/v1/profile/answers/{ans_id}");
      expect(patches.map((call) => [call.params?.ans_id, call.body])).toEqual([
        [notice.id, { auto_use: "always", base_revision: 2 }],
      ]);
      expect(toasts.calls[0]?.[1]).toBe(
        "1 done · 2 skipped · 0 changed elsewhere · 0 failed"
      );
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-PROFILE bulk Delete asks first, then DELETEs each answer with its base_revision",
    async () => {
      const first = makeAnswer({ question_key: "notice_period" });
      const second = makeAnswer({ question_key: "start_date", revision: 7 });
      const api = fakeApi({
        "GET /api/v1/profile/answers": () => ({
          items: [first, second],
          next_cursor: null,
        }),
        "DELETE /api/v1/profile/answers/{ans_id}": (request) => ({
          id: request.params?.ans_id,
          deleted: true,
        }),
      });
      renderWithProviders(<AnswersTab />);
      await waitFor(() => {
        expect(document.body.textContent).toContain("start_date");
      });
      // A row checkbox selects one row and opens nothing.
      await act(async () => {
        document
          .querySelector<HTMLElement>("[aria-label='Select start_date']")
          ?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain("1 selected");
      });
      expect(document.querySelector("[role='dialog']")).toBeNull();
      await selectAll();
      await act(async () => {
        buttonByText("Delete")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain("Delete 2 answers?");
      });
      expect(api.calls("DELETE /api/v1/profile/answers/{ans_id}")).toHaveLength(
        0
      );
      await act(async () => {
        buttonByText("Delete 2")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(
          api.calls("DELETE /api/v1/profile/answers/{ans_id}")
        ).toHaveLength(2);
      });
      expect(
        api
          .calls("DELETE /api/v1/profile/answers/{ans_id}")
          .map((call) => call.query)
      ).toEqual([{ base_revision: 2 }, { base_revision: 7 }]);
    },
    DOM_TEST_TIMEOUT
  );
});
