import { describe, expect, it } from "vitest";
import { getT } from "@/i18n";
import {
  makeAnalyticsSummary,
  makeBreakdown,
  makeTimeseries,
} from "@/test/fixtures-rest";
import { DAY_MS } from "./board-model";
import {
  automationModel,
  breakdownTable,
  formatDuration,
  funnelRows,
  funnelTable,
  rejectionRows,
  seriesPoints,
  seriesSummary,
  seriesTable,
  statCells,
  timingChartData,
  timingRows,
  timingTable,
} from "./stats-model";

const t = getT("en");
const HOUR = 3_600_000;

describe("TW-STATS view models (10 §2, §8)", () => {
  it("TW-STATS stat cells show counts and hide rates below a cohort of 5", () => {
    const summary = makeAnalyticsSummary();
    const cells = statCells(summary, t, "en");
    expect(cells.map((cell) => [cell.key, cell.value])).toEqual([
      ["applications", "18"],
      ["responseRate", "50%"],
      ["interviews", "6"],
      ["offers", "2"],
    ]);
    expect(cells[1]?.note).toBe("Of 18 applications in the period");
    expect(cells[2]?.note).toBe("Interview rate 33%");

    const small = makeAnalyticsSummary({ cohort_size: 3, rates: null });
    const hidden = statCells(small, t, "en");
    expect(hidden[1]?.value).toBe("—");
    expect(hidden[1]?.note).toBe("Rates appear after 5 applications");
    expect(hidden[2]?.note).toBeNull();
    // A server that still sends rates for a tiny cohort never shows them.
    const leaky = makeAnalyticsSummary({ cohort_size: 4 });
    expect(statCells(leaky, t, "en")[1]?.value).toBe("—");
  });

  it("TW-STATS rejection by stage lists interview rounds in order between applying and offer", () => {
    const summary = makeAnalyticsSummary({
      rejection_by_stage: {
        before_applying: 1,
        after_applying: 4,
        after_interview: [
          { round: 2, count: 1 },
          { round: 1, count: 3 },
        ],
        after_offer: 2,
      },
    });
    expect(
      rejectionRows(summary, t).map((row) => [row.label, row.value])
    ).toEqual([
      ["Before applying", 1],
      ["After applying", 4],
      ["After interview round 1", 3],
      ["After interview round 2", 1],
      ["After an offer", 2],
    ]);
  });

  it("TW-STATS durations format as days or hours; a missing median says not enough data", () => {
    expect(formatDuration(6 * DAY_MS, t, "en")).toBe("6 d");
    expect(formatDuration(1.5 * DAY_MS, t, "en")).toBe("1.5 d");
    expect(formatDuration(12.4 * DAY_MS, t, "en")).toBe("12 d");
    expect(formatDuration(18 * HOUR, t, "en")).toBe("18 h");
    expect(formatDuration(10 * 60_000, t, "en")).toBe("Under 1 h");
    expect(formatDuration(null, t, "en")).toBeNull();
    expect(formatDuration(2 * DAY_MS, getT("id"), "id")).toBe("2 hari");

    const summary = makeAnalyticsSummary();
    summary.time_metrics.time_to_offer = { median: null, p75: null, n: 0 };
    const rows = timingRows(summary, t);
    const points = timingChartData(rows);
    expect(points.map((point) => point.key)).toEqual([
      "time_to_first_response",
      "time_to_interview",
      "prep_time",
    ]);
    // Median 6 d with a whisker to the P75 of 11 d.
    expect(points[0]).toMatchObject({ median: 6, p75: 11, whisker: [0, 5] });
    const table = timingTable(rows, t, "en");
    expect(table.rows[0]?.cells).toEqual(["6 d", "11 d", "9"]);
    expect(table.rows[2]?.cells).toEqual([
      "Not enough data",
      "Not enough data",
      "0",
    ]);
  });

  it("TW-STATS the funnel and its table hold the same numbers", () => {
    const summary = makeAnalyticsSummary();
    const rows = funnelRows(summary, t);
    expect(rows.map((row) => [row.key, row.value])).toEqual([
      ["tracked", 64],
      ["applied", 18],
      ["interviewing", 6],
      ["offer", 2],
      ["accepted", 1],
    ]);
    const table = funnelTable(rows, t, "en");
    expect(table.rows.map((row) => [row.header, ...row.cells])).toEqual(
      rows.map((row) => [row.label, String(row.value)])
    );
  });

  it("TW-STATS breakdown rates show only for groups of 5 or more", () => {
    const table = breakdownTable(makeBreakdown("source"), "Source", t, "en");
    expect(table.columns.map((column) => column.label)).toEqual([
      "Source",
      "Applied",
      "Interview rate",
      "Offer rate",
      "Rejection rate",
      "Applications",
    ]);
    expect(table.rows[0]?.cells).toEqual(["8", "40%", "10%", "30%", "8"]);
    // Career page: 3 applications → counts but no rates.
    expect(table.rows[2]?.cells).toEqual(["3", "—", "—", "—", "3"]);
  });

  it("TW-STATS automation reliability: states, rates and failure classes by count", () => {
    const summary = makeAnalyticsSummary();
    summary.automation.failure_classes = {
      unsupported_form: 1,
      login_required: 3,
      some_new_class: 1,
      cancelled: 0,
    };
    const model = automationModel(summary, t, "en");
    expect(model.total).toBe(15);
    expect(model.states.map((state) => [state.label, state.value])).toEqual([
      ["Submitted", "11"],
      ["Failed", "2"],
      ["Cancelled", "1"],
      ["Needs review", "1"],
      ["Expired", "0"],
    ]);
    expect(model.rates.map((rate) => rate.value)).toEqual([
      "79%",
      "82%",
      "27%",
    ]);
    expect(model.failures.map((entry) => [entry.label, entry.value])).toEqual([
      ["Login required", "3"],
      ["some_new_class", "1"],
      ["Unsupported form", "1"],
    ]);
  });

  it("TW-STATS the weekly series table and summary match the points", () => {
    const series = makeTimeseries("applied", [1, 4, 2]);
    const points = seriesPoints(series, "en");
    expect(points.map((point) => point.label)).toEqual([
      "13 Jul",
      "20 Jul",
      "27 Jul",
    ]);
    const table = seriesTable(points, "Applications", "week", t, "en");
    expect(table.columns[0]?.label).toBe("Week of");
    expect(table.rows.map((row) => row.cells[0])).toEqual(["1", "4", "2"]);
    expect(seriesSummary(points, "Applications", t, "en")).toBe(
      "Applications: 7 in total, most in 20 Jul (4)."
    );
  });
});
