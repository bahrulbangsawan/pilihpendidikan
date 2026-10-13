// @vitest-environment happy-dom
import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  cleanup,
  FakeFailure,
  fakeApi,
  itemByText,
  pointerDown,
  renderWithProviders,
  typeInto,
  waitFor,
} from "@/components/cli/test-harness";
import {
  fixtureId,
  makeApplication,
  makeCard,
  makeDetail,
  NOW,
} from "@/test/fixtures";
import type { BulkReport } from "./bulk-bar";
import { BulkBar, BulkResultsDialog } from "./bulk-bar";

interface ToastOptions {
  action?: { onClick: () => void };
}
const toasts = vi.hoisted(() => ({
  calls: [] as [string, unknown][],
}));
vi.mock("sonner", () => {
  const record =
    (kind: string) =>
    (message: string, options?: unknown): void => {
      toasts.calls.push([kind, { message, ...(options as object) }]);
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

// happy-dom with Radix portals is slow on a loaded machine.
const DOM_TEST_TIMEOUT = 20_000;

afterEach(() => {
  cleanup();
  toasts.calls.length = 0;
});

function renderBar(selected: readonly BoardCard[]) {
  const onReport = vi.fn<(report: BulkReport) => void>();
  const onClear = vi.fn();
  renderWithProviders(
    <BulkBar onClear={onClear} onReport={onReport} selected={selected} />
  );
  return { onReport, onClear };
}

function statuses(report: BulkReport | undefined) {
  return report?.results.map((result) => [result.status, result.reason]);
}

/** The summary toast's "Details" action hands the report over. */
async function lastReport(onReport: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(toasts.calls.length).toBeGreaterThan(0));
  const options = toasts.calls.at(-1)?.[1] as ToastOptions;
  options.action?.onClick();
  return onReport.mock.calls.at(-1)?.[0] as BulkReport | undefined;
}

describe("T6-08 board bulk bar (06 §9)", () => {
  it(
    "T6-08 Delete permanently needs the typed word, sends DELETE ?purge=1 with each base_revision and skips cards with a live run",
    async () => {
      const free = makeCard({ stage: "saved", company: "Free", title: "A" });
      const archived = makeCard(
        { stage: "rejected", company: "Old", title: "B" },
        1,
        { archived: true }
      );
      const running = makeCard(
        { stage: "ready", company: "Running", title: "C" },
        2,
        {
          live_task: {
            id: fixtureId("tsk"),
            kind: "apply",
            state: "running",
            device_id: null,
            device_name: null,
            pause_reason: null,
            progress_stage: null,
            submit_intent_at: null,
            updated_at: NOW,
          },
        }
      );
      const api = fakeApi({
        "DELETE /api/v1/applications/{app_id}": (request) => ({
          id: request.params?.app_id,
          archived: false,
          purged: true,
          application: null,
        }),
      });
      const { onReport } = renderBar([free, archived, running]);
      await pointerDown(buttonByText("More") ?? null);
      const item = await waitFor(() =>
        expect(itemByText("Delete for good")).toBeTruthy()
      ).then(() => itemByText("Delete for good"));
      await pointerDown(item ?? null);
      item?.click();
      await waitFor(() =>
        expect(document.body.textContent).toContain(
          "Delete 2 applications for good?"
        )
      );
      expect(document.body.textContent).toContain(
        "timeline, interviews, offers, CV variants and files"
      );
      expect(document.body.textContent).toContain(
        "Skipped because a run or submission is in progress: 1."
      );
      const confirm = buttonByText("Delete 2 for good");
      expect(confirm?.disabled).toBe(true);
      await typeInto(
        document.querySelector<HTMLInputElement>("[role='alertdialog'] input"),
        "delete"
      );
      expect(buttonByText("Delete 2 for good")?.disabled).toBe(false);
      buttonByText("Delete 2 for good")?.click();
      const report = await lastReport(onReport);
      expect(statuses(report)).toEqual([
        ["ok", undefined],
        ["ok", undefined],
        ["skipped", "live_task"],
      ]);
      const deletes = api.calls("DELETE /api/v1/applications/{app_id}");
      expect(deletes.map((call) => call.params?.app_id)).toEqual([
        free.id,
        archived.id,
      ]);
      expect(deletes[0]?.query).toEqual({
        purge: "1",
        base_revision: free.revision,
      });
      expect(new Set(deletes.map((call) => call.idempotency_key)).size).toBe(2);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "T6-08 Archive on a mixed selection archives only the unarchived cards and skips the others unchanged",
    async () => {
      const open = makeCard({ stage: "saved", company: "Open", title: "A" });
      const archived = makeCard(
        { stage: "saved", company: "Gone", title: "B" },
        1,
        { archived: true }
      );
      const api = fakeApi({
        "PATCH /api/v1/applications/{app_id}": () => ({
          application: makeApplication({ id: open.id, archived: true }),
        }),
      });
      const { onReport } = renderBar([open, archived]);
      const archive = buttonByText("Archive");
      expect(archive?.textContent).toBe("Archive");
      archive?.click();
      const report = await lastReport(onReport);
      expect(statuses(report)).toEqual([
        ["ok", undefined],
        ["skipped", "unchanged"],
      ]);
      const patches = api.calls("PATCH /api/v1/applications/{app_id}");
      expect(patches).toHaveLength(1);
      expect(patches[0]?.body).toEqual({
        archived: true,
        base_revision: open.revision,
      });
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "T6-08 Mode auto is set only where an auto rule matched; the rest are skipped with the reason",
    async () => {
      const matched = makeCard({ stage: "saved", company: "Rule", title: "A" });
      const unmatched = makeCard(
        { stage: "saved", company: "NoRule", title: "B" },
        1
      );
      const alreadyAuto = makeCard(
        { stage: "saved", company: "Auto", title: "C", mode: "auto" },
        2
      );
      const ruleId = fixtureId("rul");
      const api = fakeApi({
        "GET /api/v1/applications/{app_id}": (request) => {
          const id = String(request.params?.app_id);
          return makeDetail({
            application: makeApplication({
              id,
              revision: 9,
              automation_rule_id: id === matched.id ? ruleId : null,
            }),
          });
        },
        "PATCH /api/v1/applications/{app_id}": (request) => ({
          application: makeApplication({
            id: String(request.params?.app_id),
            mode: "auto",
          }),
        }),
        "DELETE /api/v1/applications/{app_id}": () =>
          new FakeFailure(500, "internal"),
      });
      const { onReport } = renderBar([matched, unmatched, alreadyAuto]);
      await pointerDown(buttonByText("More") ?? null);
      await waitFor(() => expect(itemByText("Mode: Auto")).toBeTruthy());
      itemByText("Mode: Auto")?.click();
      const report = await lastReport(onReport);
      expect(statuses(report)).toEqual([
        ["ok", undefined],
        ["skipped", "no_auto_rule"],
        ["skipped", "unchanged"],
      ]);
      const patches = api.calls("PATCH /api/v1/applications/{app_id}");
      expect(patches.map((call) => call.params?.app_id)).toEqual([matched.id]);
      expect(patches[0]?.body).toEqual({ mode: "auto", base_revision: 9 });
    },
    DOM_TEST_TIMEOUT
  );

  it("T6-08 the results dialog names each card and its skip reason", () => {
    const card = makeCard({ stage: "saved", company: "Acme", title: "SRE" });
    renderWithProviders(
      <BulkResultsDialog
        onClose={vi.fn()}
        report={{
          action: "Delete for good",
          cards: new Map([[card.id, card]]),
          results: [
            {
              id: card.id,
              status: "skipped",
              reason: "live_task",
              message: "A run is working on it.",
            },
          ],
        }}
      />
    );
    expect(document.body.textContent).toContain("Acme · SRE");
    expect(document.body.textContent).toContain("A run is working on it.");
  });
});
