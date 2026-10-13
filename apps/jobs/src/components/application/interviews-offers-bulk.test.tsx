// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  cleanup,
  FakeFailure,
  fakeApi,
  itemByText,
  pointerDown,
  renderWithProviders,
  waitFor,
} from "@/components/cli/test-harness";
import {
  makeApplication,
  makeDetail,
  makeInterview,
  makeOffer,
} from "@/test/fixtures";
import { InterviewsTab } from "./interviews-tab";
import { OffersTab } from "./offers-tab";

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

async function selectAll() {
  await act(async () => {
    document.querySelector<HTMLElement>("[aria-label='Select all']")?.click();
    await Promise.resolve();
  });
}

describe("T6-08 interviews and offers bulk actions (06 §6)", () => {
  it(
    "T6-08 interviews: bulk outcome Failed skips the unchanged one, PATCHes the rest, then asks to mark the application rejected",
    async () => {
      const application = makeApplication({ stage: "interviewing" });
      const first = makeInterview(application.id, { round: 1, revision: 2 });
      const second = makeInterview(application.id, {
        round: 2,
        kind: "onsite",
        revision: 4,
      });
      const done = makeInterview(application.id, {
        round: 3,
        outcome: "failed",
      });
      const api = fakeApi({
        "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}": (request) =>
          request.params?.ivw_id === second.id
            ? new FakeFailure(409, "revision_conflict")
            : { interview: { ...first, outcome: "failed" } },
      });
      const onMove = vi.fn();
      renderWithProviders(
        <InterviewsTab
          autoOpen={false}
          detail={makeDetail({
            application,
            interviews: [first, second, done],
          })}
          onAutoOpened={() => undefined}
          onMove={onMove}
        />
      );
      await selectAll();
      await waitFor(() => {
        expect(document.body.textContent).toContain("3 selected");
      });
      await pointerDown(buttonByText("Set outcome") ?? null);
      await waitFor(() => {
        expect(itemByText("Failed")).toBeDefined();
      });
      await act(async () => {
        itemByText("Failed")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(toasts.calls).toHaveLength(1);
      });
      const patches = api.calls(
        "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}"
      );
      expect(patches.map((call) => [call.params?.ivw_id, call.body])).toEqual([
        [first.id, { outcome: "failed", base_revision: 2 }],
        [second.id, { outcome: "failed", base_revision: 4 }],
      ]);
      expect(toasts.calls[0]?.[1]).toBe(
        "1 done · 1 skipped · 1 changed elsewhere · 0 failed"
      );
      await waitFor(() => {
        expect(document.body.textContent).toContain(
          "Mark the application rejected?"
        );
      });
      expect(onMove).not.toHaveBeenCalled();
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "T6-08 interviews and offers: bulk Delete asks first, then DELETEs each with its base_revision",
    async () => {
      const application = makeApplication({ stage: "offer" });
      const interviews = [
        makeInterview(application.id, { round: 1, revision: 3 }),
        makeInterview(application.id, { round: 2, revision: 5 }),
      ];
      const offers = [
        makeOffer(application.id, { revision: 2 }),
        makeOffer(application.id, { revision: 6, status: "declined" }),
      ];
      const api = fakeApi({
        "DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}": (
          request
        ) => ({ id: request.params?.ivw_id, deleted: true }),
        "DELETE /api/v1/applications/{app_id}/offers/{ofr_id}": (request) => ({
          id: request.params?.ofr_id,
          deleted: true,
        }),
      });
      const detail = makeDetail({ application, interviews, offers });
      const interviewsView = renderWithProviders(
        <InterviewsTab
          autoOpen={false}
          detail={detail}
          onAutoOpened={() => undefined}
          onMove={() => undefined}
        />
      );
      await selectAll();
      await act(async () => {
        buttonByText("Delete")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain("Delete 2 interviews?");
      });
      const interviewDeletes = () =>
        api.calls("DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}");
      expect(interviewDeletes()).toHaveLength(0);
      await act(async () => {
        buttonByText("Delete 2")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(interviewDeletes()).toHaveLength(2);
      });
      expect(interviewDeletes().map((call) => call.query)).toEqual([
        { base_revision: 3 },
        { base_revision: 5 },
      ]);
      interviewsView.unmount();
      document.body.replaceChildren();

      renderWithProviders(
        <OffersTab detail={detail} onMove={() => undefined} />
      );
      await selectAll();
      await waitFor(() => {
        expect(document.body.textContent).toContain("2 selected");
      });
      await act(async () => {
        buttonByText("Delete")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain("Delete 2 offers?");
      });
      await act(async () => {
        buttonByText("Delete 2")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(
          api.calls("DELETE /api/v1/applications/{app_id}/offers/{ofr_id}")
        ).toHaveLength(2);
      });
      expect(
        api
          .calls("DELETE /api/v1/applications/{app_id}/offers/{ofr_id}")
          .map((call) => call.params)
          .every((params) => params?.app_id === application.id)
      ).toBe(true);
    },
    DOM_TEST_TIMEOUT
  );
});
