// Cloudflare Browser Rendering for `browser` sources with
// `renderer: "browser_rendering"` (job-tracker-spec/24 §4.4). The page is
// opened with the honest pilih-jobs User-Agent; every request goes through
// `blockReason` (robots-disallowed paths of the site, trackers, media, local
// hosts). Nothing here solves or waits out a challenge: whatever the page
// shows is handed to the container, which classifies it like a fetched page.

import puppeteer from "@cloudflare/puppeteer";
import { blockReason } from "./render-policy";
import type { RobotsRules } from "./robots";

export interface RenderInput {
  robots: RobotsRules;
  timeoutMs: number;
  url: string;
  userAgent: string;
  waitSelector: string | null;
}

export interface RenderOutput {
  blocked: number;
  finalUrl: string;
  html: string;
  status: number;
}

export class RenderError extends Error {
  readonly errorClass: "timeout" | "engine_unavailable";
  constructor(errorClass: "timeout" | "engine_unavailable", message: string) {
    super(message);
    this.name = "RenderError";
    this.errorClass = errorClass;
  }
}

const SELECTOR_WAIT_MS = 10_000;

export async function renderPage(
  binding: Fetcher,
  input: RenderInput
): Promise<RenderOutput> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  try {
    browser = await puppeteer.launch(binding);
  } catch (err) {
    throw new RenderError(
      "engine_unavailable",
      `Browser Rendering could not start a browser (${err instanceof Error ? err.message : String(err)}).`
    );
  }
  try {
    const page = await browser.newPage();
    await page.setUserAgent(input.userAgent);
    await page.setRequestInterception(true);
    const host = new URL(input.url).hostname.toLowerCase();
    let blocked = 0;
    page.on("request", (request) => {
      const reason = blockReason(request.url(), request.resourceType(), {
        host,
        robots: input.robots,
      });
      if (reason !== null && !request.isNavigationRequest()) {
        blocked += 1;
        request.abort().catch(() => undefined);
        return;
      }
      request.continue().catch(() => undefined);
    });
    let response: Awaited<ReturnType<typeof page.goto>>;
    try {
      response = await page.goto(input.url, {
        waitUntil: "networkidle0",
        timeout: input.timeoutMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RenderError(
        message.toLowerCase().includes("timeout")
          ? "timeout"
          : "engine_unavailable",
        `The page did not finish rendering: ${message}`.slice(0, 400)
      );
    }
    if (input.waitSelector) {
      await page
        .waitForSelector(input.waitSelector, { timeout: SELECTOR_WAIT_MS })
        .catch(() => undefined);
    }
    return {
      blocked,
      finalUrl: page.url(),
      html: await page.content(),
      status: response?.status() ?? 0,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
