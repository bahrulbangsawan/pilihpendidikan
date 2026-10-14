import { describe, expect, it } from "bun:test";
import { createCtx, createFakeClock, createTestEnv } from "../../../test/fakes";
import {
  CLOCK_ENSURE_INTERVAL_MS,
  maybeEnsureSchedulerClock,
  runSchedulerTick,
} from "./fallback";

describe("T24-CLOCK scheduler fallback (24 §6.6)", () => {
  it("T24-CLOCK-01 ticks the 5-minute and hourly schedules only", async () => {
    const t = createTestEnv();
    const deps = { clock: createFakeClock() };
    const five = await runSchedulerTick(
      "*/5 * * * *",
      t.env,
      createCtx(),
      deps
    );
    expect(five.ran).toEqual(["leases", "cloud-reaper"]);
    const hourly = await runSchedulerTick(
      "0 * * * *",
      t.env,
      createCtx(),
      deps
    );
    expect(hourly.ran).toEqual(["cloud-dispatch"]);
    await expect(
      runSchedulerTick("0 3 * * *", t.env, createCtx(), deps)
    ).rejects.toThrow("does not run");
  });

  it("T24-CLOCK-02 asks the scraper to arm its clock at most every 10 minutes per isolate", async () => {
    const calls: string[] = [];
    const scraper = {
      fetch: (url: string) => {
        calls.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    } as unknown as Fetcher;
    const env = { SCRAPER: scraper };
    expect(await maybeEnsureSchedulerClock(env, 1000)).toBe(true);
    expect(await maybeEnsureSchedulerClock(env, 2000)).toBe(false);
    expect(
      await maybeEnsureSchedulerClock(env, 1000 + CLOCK_ENSURE_INTERVAL_MS)
    ).toBe(true);
    expect(calls).toEqual([
      "https://scraper.internal/clock/ensure",
      "https://scraper.internal/clock/ensure",
    ]);
    // Dev with the local Python scraper, or no binding: nothing to arm.
    expect(
      await maybeEnsureSchedulerClock(
        { SCRAPER: scraper, SCRAPER_FALLBACK_URL: "http://localhost:8791" },
        9e12
      )
    ).toBe(false);
    expect(await maybeEnsureSchedulerClock({}, 9e12)).toBe(false);
  });

  it("T24-CLOCK-03 a failing scraper never breaks the request path", async () => {
    const env = {
      SCRAPER: {
        fetch: () => Promise.reject(new TypeError("down")),
      } as unknown as Fetcher,
    };
    expect(await maybeEnsureSchedulerClock(env, 5)).toBe(false);
  });
});
