import { describe, expect, it } from "vitest";
import { makeDevice, NOW } from "@/test/fixtures";
import {
  discoverCapable,
  RUN_NOW_MAX_SOURCES,
  runNowBatches,
} from "./sources-model";

describe("TW-SOURCES bulk Run now (12 §8)", () => {
  it("TW-SOURCES splits sources into discover tasks of at most 50, without duplicates", () => {
    const ids = Array.from({ length: 120 }, (_, index) => `src_${index}`);
    const batches = runNowBatches([...ids, "src_0"]);
    expect(batches.map((batch) => batch.length)).toEqual([
      RUN_NOW_MAX_SOURCES,
      RUN_NOW_MAX_SOURCES,
      20,
    ]);
    expect(batches.flat()).toEqual(ids);
    expect(runNowBatches([])).toEqual([]);
  });

  it("TW-SOURCES only live devices that discover and accept tasks can run it", () => {
    const ok = makeDevice({ name: "MacBook" });
    const busy = makeDevice({ name: "Off", accepts_tasks: false });
    const revoked = makeDevice({ name: "Gone", revoked_at: NOW });
    const noDiscover = makeDevice({
      name: "Apply only",
      capabilities: ["apply"],
    });
    expect(
      discoverCapable([ok, busy, revoked, noDiscover]).map((d) => d.name)
    ).toEqual(["MacBook"]);
  });
});
