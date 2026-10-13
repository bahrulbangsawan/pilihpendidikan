// @vitest-environment happy-dom
import type { AnalyticsSummaryResponse } from "@pilihpendidikan/jobs-contracts/api";
import type {
  AnalyticsBreakdown,
  AnalyticsMetric,
} from "@pilihpendidikan/jobs-contracts/enums";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import { isoDay } from "@/lib/board-model";
import { browserTimeZone } from "@/lib/format";
import type { StatsSearch } from "@/lib/stats-range";
import {
  makeAnalyticsSummary,
  makeBreakdown,
  makeTimeseries,
} from "@/test/fixtures-rest";
import { click, render } from "@/test/render";
import { StatsPage } from "./stats-page";

interface FakeApi {
  requests: BffRequest[];
  summary: AnalyticsSummaryResponse;
  failSummary: boolean;
}

function okResult(data: unknown): BffResult {
  return {
    ok: true,
    status: 200,
    data: data as JsonValue,
    etag: null,
    notModified: false,
    replayed: false,
  };
}

function installApi(summary = makeAnalyticsSummary()): FakeApi {
  const api: FakeApi = { requests: [], summary, failSummary: false };
  setBffTransport((request) => {
    api.requests.push(request);
    const query = request.query ?? {};
    switch (request.route) {
      case "GET /api/v1/analytics/summary":
        return Promise.resolve(
          api.failSummary
            ? {
                ok: false,
                status: 503,
                error: { error: "upstream_unavailable", message: "down" },
              }
            : okResult(api.summary)
        );
      case "GET /api/v1/analytics/timeseries":
        return Promise.resolve(
          okResult(makeTimeseries(query.metric as AnalyticsMetric))
        );
      case "GET /api/v1/analytics/breakdown":
        return Promise.resolve(
          okResult(makeBreakdown(query.by as AnalyticsBreakdown))
        );
      default:
        return Promise.resolve({
          ok: false,
          status: 404,
          error: { error: "not_found", message: request.route },
        });
    }
  });
  return api;
}

/** Holds the URL search like the route does, so switchers re-query. */
function Harness({ initial }: { initial: StatsSearch }) {
  const [search, setSearch] = useState(initial);
  return <StatsPage onSearchChange={setSearch} search={search} />;
}

function mount(initial: StatsSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>
  );
}

async function settle(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function until(
  check: () => boolean,
  label: string,
  rounds = 40
): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    if (check()) {
      return;
    }
    await settle(1);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function frames(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-chart-frame]")];
}

function toggleOf(frame: Element): HTMLButtonElement {
  const button = frame.querySelector<HTMLButtonElement>("button[aria-pressed]");
  if (!button) {
    throw new Error("no toggle");
  }
  return button;
}

async function change(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

/** happy-dom has no layout: give every box a size so Recharts draws. */
function stubLayout() {
  const box = { width: 640, height: 240 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: box.width,
    bottom: box.height,
    ...box,
    toJSON: () => box,
  } as DOMRect);
  for (const [name, value] of [
    ["clientWidth", box.width],
    ["clientHeight", box.height],
    ["offsetWidth", box.width],
    ["offsetHeight", box.height],
  ] as const) {
    vi.spyOn(HTMLElement.prototype, name, "get").mockReturnValue(value);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  stubLayout();
  // AppLink outside a router warns once per render; the links are checked
  // by their href.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  setBffTransport(null);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("T10-10 chart data tables and keyboard access (10 §8, 12 §12)", () => {
  it("T10-10 every chart on the page has a toggle that swaps the chart for a table and back", async () => {
    installApi();
    const { container } = mount();
    await until(() => frames(container).length === 4, "four charts");
    await until(
      () =>
        !frames(container).some((f) => f.querySelector("[data-slot=skeleton]")),
      "series loaded"
    );
    expect(frames(container).map((frame) => frame.dataset.chartFrame)).toEqual([
      "funnel",
      "series",
      "rejection",
      "timing",
    ]);
    for (const frame of frames(container)) {
      const toggle = toggleOf(frame);
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(
        frame.querySelector("[role=img] svg.recharts-surface")
      ).not.toBeNull();
      expect(frame.querySelector("table")).toBeNull();
      await click(toggle);
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(frame.querySelector("[role=img]")).toBeNull();
      expect(frame.querySelector("table")).not.toBeNull();
      await click(toggle);
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(frame.querySelector("table")).toBeNull();
    }
  });

  it("T10-10 the toggle is a focusable button that keyboards can press; the chart is a labelled image; the choice is remembered", async () => {
    installApi();
    const first = mount();
    await until(() => frames(first.container).length === 4, "charts");
    const funnel = frames(first.container)[0] as HTMLElement;
    const toggle = toggleOf(funnel);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.type).toBe("button");
    expect(toggle.disabled).toBe(false);
    expect(toggle.tabIndex).toBeGreaterThanOrEqual(0);
    expect(toggle.textContent).toContain("Data table");
    expect(toggle.getAttribute("aria-controls")).toBeTruthy();
    // The image's name says what the chart shows.
    expect(funnel.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Funnel: Tracked 64, Applied 18, Interviewing 6, Offer 2, Accepted 1."
    );
    await act(async () => {
      toggle.focus();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(toggle);
    // Enter / Space on a native button activate it (a click); nothing in the
    // toggle swallows the keys.
    const keydown = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    toggle.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);
    await click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    first.unmount();

    // Remembered for this chart only, on the next visit.
    const second = mount();
    await until(() => frames(second.container).length === 4, "charts again");
    const [funnelAgain, ...others] = frames(second.container);
    expect(funnelAgain?.querySelector("table")).not.toBeNull();
    for (const frame of others) {
      expect(frame.querySelector("table")).toBeNull();
    }
  });

  it("T10-10 the data tables have a caption, scoped headers and the chart's numbers", async () => {
    installApi();
    const { container } = mount();
    await until(() => frames(container).length === 4, "charts");
    const [funnel, , rejection, timing] = frames(container) as HTMLElement[];
    // The chart draws one bar per step, labelled with the table's numbers.
    expect(funnel?.querySelectorAll(".recharts-bar-rectangle").length).toBe(5);
    expect(
      [...(funnel?.querySelectorAll(".recharts-label-list text") ?? [])].map(
        (text) => text.textContent
      )
    ).toEqual(["64", "18", "6", "2", "1"]);
    for (const frame of [funnel, rejection, timing] as HTMLElement[]) {
      await click(toggleOf(frame));
    }
    const table = funnel?.querySelector("table") as HTMLTableElement;
    expect(table.querySelector("caption")?.textContent).toBe(
      "Applications per funnel step in the period."
    );
    expect(
      [...table.querySelectorAll("thead th")].map((th) =>
        th.getAttribute("scope")
      )
    ).toEqual(["col", "col"]);
    const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [
      tr.querySelector("th[scope=row]")?.textContent,
      tr.querySelector("td")?.textContent,
    ]);
    expect(rows).toEqual([
      ["Tracked", "64"],
      ["Applied", "18"],
      ["Interviewing", "6"],
      ["Offer", "2"],
      ["Accepted", "1"],
    ]);
    const rejectionRows = [
      ...(rejection?.querySelectorAll("tbody th[scope=row]") ?? []),
    ].map((th) => th.textContent);
    expect(rejectionRows).toEqual([
      "Before applying",
      "After applying",
      "After interview round 1",
      "After interview round 2",
      "After an offer",
    ]);
    const timingCells = [
      ...(timing?.querySelectorAll("tbody tr:first-child td") ?? []),
    ].map((td) => td.textContent);
    expect(timingCells).toEqual(["6 d", "11 d", "9"]);
  });
});

describe("TW-STATS stats page (12 §9, 10 §8)", () => {
  it("TW-STATS shows the four stat cells and, below a cohort of 5, the rates hint", async () => {
    installApi(makeAnalyticsSummary({ cohort_size: 3, rates: null }));
    const { container } = mount();
    await until(
      () => container.querySelector("[data-stat=applications]") !== null,
      "stat cells"
    );
    const cell = (key: string) =>
      container.querySelector(`[data-stat=${key}]`)?.textContent ?? "";
    expect(cell("applications")).toContain("Applications18");
    expect(cell("responseRate")).toContain("—");
    expect(cell("responseRate")).toContain("Rates appear after 5 applications");
    expect(cell("interviews")).toContain("6");
    expect(cell("offers")).toContain("2");
  });

  it("TW-STATS a range preset queries from, to and the browser time zone", async () => {
    const api = installApi();
    const { container } = mount({ range: "30d" });
    await until(() => api.requests.length >= 3, "requests");
    const today = isoDay(new Date());
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    start.setDate(start.getDate() - 29);
    const summary = api.requests.find(
      (request) => request.route === "GET /api/v1/analytics/summary"
    );
    expect(summary?.query).toEqual({
      from: isoDay(start),
      to: today,
      tz: browserTimeZone(),
    });
    const series = api.requests.find(
      (request) => request.route === "GET /api/v1/analytics/timeseries"
    );
    expect(series?.query).toMatchObject({
      metric: "applied",
      interval: "week",
    });

    // Switching to all time asks again with the new range and monthly buckets.
    const preset = container.querySelector("select");
    expect(preset?.value).toBe("30d");
    await change(preset as HTMLSelectElement, "all");
    await until(
      () =>
        api.requests.some(
          (request) =>
            request.route === "GET /api/v1/analytics/timeseries" &&
            request.query?.interval === "month"
        ),
      "all-time series"
    );
    expect(
      api.requests.some(
        (request) =>
          request.route === "GET /api/v1/analytics/summary" &&
          request.query?.from === "2020-01-01"
      )
    ).toBe(true);
  });

  it("TW-STATS the breakdown switcher refetches with the chosen dimension", async () => {
    const api = installApi();
    const { container } = mount();
    await until(
      () => container.querySelector("[data-stat=applications]") !== null,
      "page"
    );
    await until(
      () => container.textContent?.includes("Greenhouse") ?? false,
      "breakdown"
    );
    const by = [...container.querySelectorAll("select")].find(
      (select) => select.value === "source"
    ) as HTMLSelectElement;
    await change(by, "mode");
    await until(
      () =>
        api.requests.some(
          (request) =>
            request.route === "GET /api/v1/analytics/breakdown" &&
            request.query?.by === "mode"
        ),
      "breakdown by mode"
    );
    await until(
      () => container.textContent?.includes("Approval") ?? false,
      "mode rows"
    );
    const section = [...container.querySelectorAll("section")].find(
      (element) => element.querySelector("h2")?.textContent === "Breakdown"
    );
    const table = section?.querySelector("table");
    expect(table?.querySelector("thead th")?.textContent).toBe("Mode");
    expect(
      [...(table?.querySelectorAll("tbody th[scope=row]") ?? [])].map(
        (th) => th.textContent
      )
    ).toEqual(["Approval", "Assisted", "Manual"]);
  });

  it("TW-STATS the automation card and the unconfirmed callout link to the right places", async () => {
    installApi(makeAnalyticsSummary({ unconfirmed_count: 2 }));
    const { container } = mount();
    await until(
      () =>
        container.textContent?.includes("2 submissions are unconfirmed") ??
        false,
      "callout"
    );
    const link = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Review on the board"
    );
    expect(link?.getAttribute("href")).toBe("/board?attention=1");
    const text = container.textContent ?? "";
    expect(text).toContain("15 apply runs finished in the period.");
    expect(text).toContain("Success rate79%");
    expect(text).toContain("Login required");
    const runs = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "See the runs"
    );
    expect(runs?.getAttribute("href")).toBe("/automation/runs");
  });

  it("TW-STATS an empty period shows the empty state with Board and Inbox", async () => {
    const empty = makeAnalyticsSummary({
      cohort_size: 0,
      rates: null,
      unconfirmed_count: 0,
      funnel: {
        tracked: 0,
        applied: 0,
        interviewing: 0,
        offer: 0,
        accepted: 0,
        rejected_total: 0,
        withdrawn_total: 0,
      },
    });
    const api = installApi(empty);
    const { container } = mount({ range: "30d" });
    await until(
      () => container.textContent?.includes("Nothing to count yet") ?? false,
      "empty state"
    );
    expect(frames(container)).toHaveLength(0);
    const hrefs = [...container.querySelectorAll("a")].map((anchor) =>
      anchor.getAttribute("href")
    );
    expect(hrefs).toEqual(expect.arrayContaining(["/board", "/inbox"]));
    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Show all time"
    );
    await click(showAll);
    await until(
      () =>
        api.requests.some(
          (request) =>
            request.route === "GET /api/v1/analytics/summary" &&
            request.query?.from === "2020-01-01"
        ),
      "all-time summary"
    );
  });

  it("TW-STATS a failed summary shows an error with Retry, which asks again", async () => {
    const api = installApi();
    api.failSummary = true;
    const { container } = mount();
    await until(
      () =>
        container.textContent?.includes("Couldn't load your stats") ?? false,
      "error"
    );
    const before = api.requests.filter(
      (request) => request.route === "GET /api/v1/analytics/summary"
    ).length;
    api.failSummary = false;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry"
    );
    await click(retry);
    await until(
      () => container.querySelector("[data-stat=applications]") !== null,
      "recovered"
    );
    expect(
      api.requests.filter(
        (request) => request.route === "GET /api/v1/analytics/summary"
      ).length
    ).toBeGreaterThan(before);
  });
});
