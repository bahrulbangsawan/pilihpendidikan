// @vitest-environment happy-dom
import type {
  InboxBulkRequest,
  InboxItem,
} from "@pilihpendidikan/jobs-contracts/api";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBoard, makeDevice } from "@/test/fixtures";
import { makeInboxItem, makeRun, makeSource } from "@/test/fixtures-rest";
import { InboxPage } from "./inbox-page";
import type { RouteHandler } from "./inbox-test-harness";
import {
  cleanup,
  fakeApi,
  press,
  renderWithQuery,
  waitFor,
} from "./inbox-test-harness";

const WEB_KEY_RE = /^web:/;

afterEach(cleanup);

const items: InboxItem[] = [
  makeInboxItem({
    company: "Acme",
    title: "Senior Frontend Engineer",
    score: 91,
  }),
  makeInboxItem({ company: "Globex", title: "Data Analyst", score: null }),
  makeInboxItem({ company: "Initech", title: "SRE", score: "queued" }),
  makeInboxItem({ company: "Umbrella", title: "Backend Engineer", score: 64 }),
];

function handlers(
  overrides: Partial<Record<string, RouteHandler>> = {}
): Partial<Record<string, RouteHandler>> {
  const device = makeDevice();
  return {
    "GET /api/v1/inbox": () => ({ items, next_cursor: null }),
    "GET /api/v1/discovery/runs": () => ({
      items: [
        makeRun(device.id, {
          started_at: Date.now() - 3_600_000,
          finished_at: Date.now() - 3_000_000,
        }),
      ],
      next_cursor: null,
    }),
    "GET /api/v1/sources": () => ({ items: [makeSource()], next_cursor: null }),
    "GET /api/v1/devices": () => ({ items: [device], next_cursor: null }),
    "GET /api/v1/board": () => makeBoard([], { inbox_new: 4 }),
    "POST /api/v1/inbox:bulk": (request) => {
      const body = request.body as InboxBulkRequest;
      return {
        results: body.user_job_ids.map((id) => ({
          user_job_id: id,
          status: "ok",
          inbox_state: body.action === "track" ? "tracked" : "dismissed",
          ...(body.action === "track"
            ? { application_id: `app_for_${id}` }
            : {}),
        })),
      };
    },
    ...overrides,
  };
}

function rowOf(container: Element, title: string): HTMLElement {
  const row = [
    ...container.querySelectorAll<HTMLElement>("tr[data-row-id]"),
  ].find((element) => element.textContent?.includes(title));
  if (!row) {
    throw new Error(`no row ${title}`);
  }
  return row;
}

function renderInbox(onNavigate = vi.fn()) {
  const rendered = renderWithQuery(
    <InboxPage onNavigate={onNavigate} onSearchChange={vi.fn()} search={{}} />
  );
  return { ...rendered, onNavigate };
}

describe("TW-INBOX inbox screen (12 §4)", () => {
  it("TW-INBOX shows the score cell as a number with a bar, a queued mark or a dash, sorted by score", async () => {
    fakeApi(handlers());
    const { container } = renderInbox();
    await waitFor(
      () => container.querySelectorAll("tr[data-row-id]").length === 4
    );
    const titles = [...container.querySelectorAll("tr[data-row-id]")].map(
      (row) => row.querySelector("a")?.textContent
    );
    expect(titles).toEqual([
      "Senior Frontend Engineer",
      "Backend Engineer",
      "SRE",
      "Data Analyst",
    ]);
    const acme = rowOf(container, "Senior Frontend Engineer");
    const scoreButton = acme.querySelector<HTMLElement>("[data-score='high']");
    expect(scoreButton?.getAttribute("aria-label")).toBe("Score 91, show why");
    expect(scoreButton?.textContent).toContain("91");
    expect(
      rowOf(container, "SRE").querySelector("[data-score='queued']")
        ?.textContent
    ).toContain("◌");
    expect(
      rowOf(container, "Data Analyst").querySelector("[data-score='none']")
        ?.textContent
    ).toContain("—");
    expect(container.textContent).toContain("Run on MacBook");
  });

  it("TW-INBOX the score tooltip and the expanded row show the explanation", async () => {
    const requests = fakeApi(
      handlers({
        "GET /api/v1/scores/{posting_id}": () => ({
          score: null,
          profile_version: 4,
        }),
      })
    );
    const { container } = renderInbox();
    const acme = await waitFor(() =>
      rowOf(container, "Senior Frontend Engineer")
    );
    const trigger = acme.querySelector<HTMLElement>("[data-score='high']");
    await act(async () => {
      trigger?.focus();
      await Promise.resolve();
    });
    const tooltip = await waitFor(() =>
      document.body.querySelector("[data-slot='tooltip-content']")
    );
    expect(tooltip.textContent).toContain("91 · Good match");
    expect(tooltip.textContent).toContain("Skills: react, typescript");
    await waitFor(() =>
      requests.some(
        (request) => request.route === "GET /api/v1/scores/{posting_id}"
      )
    );
    const expand = acme.querySelector<HTMLButtonElement>(
      "button[aria-label^='Show details']"
    );
    await act(async () => {
      expand?.click();
      await Promise.resolve();
    });
    const details = await waitFor(() =>
      [...container.querySelectorAll("td[colspan]")].find((cell) =>
        cell.textContent?.includes("Provenance")
      )
    );
    expect(details.textContent).toContain("Extraction confidence");
    expect(details.textContent).toContain("97%");
    expect(details.textContent).toContain("Greenhouse");
  });

  it("TW-INBOX J / K move the focused row, X selects it, S tracks the selection through inbox:bulk", async () => {
    const requests = fakeApi(handlers());
    const { container, onNavigate } = renderInbox();
    await waitFor(
      () => container.querySelectorAll("tr[data-row-id]").length === 4
    );
    await press("j");
    await press("j");
    const focused = await waitFor(() =>
      container.querySelector<HTMLElement>("tr[data-focused='true']")
    );
    expect(focused.textContent).toContain("Backend Engineer");
    expect(document.activeElement).toBe(focused);
    await press("k");
    expect(
      container.querySelector("tr[data-focused='true']")?.textContent
    ).toContain("Senior Frontend Engineer");
    await press("x");
    expect(
      rowOf(container, "Senior Frontend Engineer").getAttribute("data-state")
    ).toBe("selected");
    expect(container.textContent).toContain("1 selected");
    await press("s");
    await waitFor(() =>
      requests.some((request) => request.route === "POST /api/v1/inbox:bulk")
    );
    const bulk = requests.find(
      (request) => request.route === "POST /api/v1/inbox:bulk"
    );
    expect(bulk?.body).toEqual({
      action: "track",
      user_job_ids: [items[0]?.user_job.id],
    });
    expect(bulk?.idempotency_key).toMatch(WEB_KEY_RE);
    // Enter on the focused row opens the job.
    const row = rowOf(container, "Backend Engineer");
    await act(async () => {
      row.focus();
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await Promise.resolve();
    });
    expect(onNavigate).toHaveBeenCalledWith(
      `/jobs/${encodeURIComponent(items[3]?.user_job.id ?? "")}`
    );
  });

  it("TW-INBOX D dismisses the focused row when nothing is selected", async () => {
    const requests = fakeApi(handlers());
    const { container } = renderInbox();
    await waitFor(
      () => container.querySelectorAll("tr[data-row-id]").length === 4
    );
    await press("j");
    await press("d");
    await waitFor(() =>
      requests.some((request) => request.route === "POST /api/v1/inbox:bulk")
    );
    expect(
      requests.find((request) => request.route === "POST /api/v1/inbox:bulk")
        ?.body
    ).toEqual({ action: "dismiss", user_job_ids: [items[0]?.user_job.id] });
  });

  it("TW-INBOX the dismissed tab selects all and restores through inbox:bulk, with no Dismiss button", async () => {
    const dismissed = [
      makeInboxItem({
        company: "Hooli",
        title: "Platform Engineer",
        score: 80,
        inboxState: "dismissed",
      }),
      makeInboxItem({
        company: "Pied Piper",
        title: "Compression Engineer",
        score: 70,
        inboxState: "dismissed",
      }),
    ];
    const requests = fakeApi(
      handlers({
        "GET /api/v1/inbox": () => ({ items: dismissed, next_cursor: null }),
        "POST /api/v1/inbox:bulk": (request) => {
          const body = request.body as InboxBulkRequest;
          return {
            results: body.user_job_ids.map((id) => ({
              user_job_id: id,
              status: "ok",
              inbox_state: "seen",
            })),
          };
        },
      })
    );
    const { container } = renderWithQuery(
      <InboxPage
        onNavigate={vi.fn()}
        onSearchChange={vi.fn()}
        search={{ state: "dismissed" }}
      />
    );
    await waitFor(
      () => container.querySelectorAll("tr[data-row-id]").length === 2
    );
    const selectAll = container.querySelector<HTMLElement>(
      "[aria-label='Select every row']"
    );
    await act(async () => {
      selectAll?.click();
      await Promise.resolve();
    });
    await waitFor(() => container.textContent?.includes("2 selected"));
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.some((button) => button.textContent === "DismissD")).toBe(
      false
    );
    const restore = buttons.find((button) =>
      button.textContent?.includes("Restore")
    );
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    await waitFor(() =>
      requests.some((request) => request.route === "POST /api/v1/inbox:bulk")
    );
    expect(
      requests.find((request) => request.route === "POST /api/v1/inbox:bulk")
        ?.body
    ).toEqual({
      action: "restore",
      user_job_ids: dismissed.map((item) => item.user_job.id),
    });
  });

  it("TW-INBOX empty inbox: no sources asks for one; sources without runs show the discover command; otherwise all caught up", async () => {
    fakeApi(
      handlers({
        "GET /api/v1/inbox": () => ({ items: [], next_cursor: null }),
        "GET /api/v1/sources": () => ({ items: [], next_cursor: null }),
        "GET /api/v1/discovery/runs": () => ({ items: [], next_cursor: null }),
      })
    );
    const first = renderInbox();
    await waitFor(() =>
      first.container.querySelector("[data-empty='no_sources']")
    );
    expect(first.container.textContent).toContain(
      "Add a source to start discovering jobs."
    );
    first.unmount();

    fakeApi(
      handlers({
        "GET /api/v1/inbox": () => ({ items: [], next_cursor: null }),
        "GET /api/v1/discovery/runs": () => ({ items: [], next_cursor: null }),
      })
    );
    const second = renderInbox();
    await waitFor(() =>
      second.container.querySelector("[data-empty='no_runs']")
    );
    expect(second.container.textContent).toContain("pilih-jobs discover --all");
    second.unmount();

    fakeApi(
      handlers({
        "GET /api/v1/inbox": () => ({ items: [], next_cursor: null }),
      })
    );
    const third = renderInbox();
    await waitFor(() =>
      third.container.querySelector("[data-empty='caught_up']")
    );
    expect(third.container.textContent).toContain("No new jobs. Last run");
  });
});
