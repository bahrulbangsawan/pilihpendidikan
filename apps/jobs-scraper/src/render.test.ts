import { describe, expect, test } from "bun:test";
import { blockReason, wantsBrowserRendering } from "./render-policy";
import { parseRobots, productToken, robotsAllows } from "./robots";
import { failedScrape } from "./scrape-response";

const DYNAMITE_ROBOTS = `User-agent: *
Disallow: /api/
Disallow: /form/
Disallow: /app/

Sitemap: https://dynamitejobs.com/sitemap/index.xml`;

describe("T24-RENDER robots for render subrequests (RFC 9309)", () => {
  test("the * group applies; longest match wins; Allow wins ties", () => {
    const rules = parseRobots(DYNAMITE_ROBOTS, "pilih-jobs");
    expect(robotsAllows(rules, "/remote-jobs")).toBe(true);
    expect(robotsAllows(rules, "/api/jobs?page=2")).toBe(false);
    expect(robotsAllows(rules, "/application")).toBe(true);
    const mixed = parseRobots(
      "User-agent: *\nDisallow: /jobs\nAllow: /jobs/public\nDisallow: /*.json$\n",
      "pilih-jobs"
    );
    expect(robotsAllows(mixed, "/jobs/secret")).toBe(false);
    expect(robotsAllows(mixed, "/jobs/public/1")).toBe(true);
    expect(robotsAllows(mixed, "/feed.json")).toBe(false);
    expect(robotsAllows(mixed, "/feed.json?x=1")).toBe(true);
  });

  test("a group naming our product token beats *; empty Disallow allows", () => {
    const rules = parseRobots(
      "User-agent: pilih-jobs\nDisallow: /private\n\nUser-agent: *\nDisallow: /\n",
      productToken("pilih-jobs/0.1.0 (+https://pilihpendidikan.com/bot)")
    );
    expect(robotsAllows(rules, "/remote-jobs")).toBe(true);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(
      robotsAllows(
        parseRobots("User-agent: *\nDisallow:\n", "pilih-jobs"),
        "/x"
      )
    ).toBe(true);
    expect(robotsAllows(parseRobots(null, "pilih-jobs"), "/anything")).toBe(
      true
    );
  });
});

describe("T24-RENDER what a render may load (24 §4.4)", () => {
  const site = {
    host: "dynamitejobs.com",
    robots: parseRobots(DYNAMITE_ROBOTS, "pilih-jobs"),
  };

  test("the page's own scripts and search provider load; disallowed paths do not", () => {
    expect(
      blockReason("https://dynamitejobs.com/_nuxt/app.js", "script", site)
    ).toBeNull();
    expect(
      blockReason(
        "https://49hkl9g3sb-dsn.algolia.net/1/indexes/*/queries",
        "fetch",
        site
      )
    ).toBeNull();
    expect(
      blockReason("https://dynamitejobs.com/api/jobs", "fetch", site)
    ).toBe("robots");
  });

  test("trackers, media, local hosts and odd schemes are blocked", () => {
    expect(
      blockReason("https://www.googletagmanager.com/gtag/js", "script", site)
    ).toBe("tracker");
    expect(
      blockReason(
        "https://o1.ingest.us.sentry.io/api/1/envelope/",
        "fetch",
        site
      )
    ).toBe("tracker");
    expect(
      blockReason("https://firestore.googleapis.com/v1/x", "fetch", site)
    ).toBe("tracker");
    expect(
      blockReason("https://cdn.dynamitejobs.com/logo.webp", "image", site)
    ).toBe("type");
    expect(
      blockReason("http://169.254.169.254/latest/meta-data", "fetch", site)
    ).toBe("local");
    expect(blockReason("http://localhost:8080/", "fetch", site)).toBe("local");
    expect(blockReason("ftp://example.com/x", "other", site)).toBe("scheme");
    expect(blockReason("data:text/plain,hi", "other", site)).toBeNull();
  });

  test("only opted-in browser sources with renderer browser_rendering are rendered", () => {
    const body = (
      config: Record<string, unknown>,
      allow = true,
      strategy = "browser"
    ) => ({
      source: { strategy, allow_browser: allow, strategy_config: config },
    });
    const config = {
      url: "https://dynamitejobs.com/remote-jobs",
      renderer: "browser_rendering",
    };
    expect(wantsBrowserRendering(body(config))).toBe(
      "https://dynamitejobs.com/remote-jobs"
    );
    expect(wantsBrowserRendering(body(config, false))).toBeNull();
    expect(
      wantsBrowserRendering(body(config, true, "html_selectors"))
    ).toBeNull();
    expect(
      wantsBrowserRendering(body({ ...config, renderer: "container" }))
    ).toBeNull();
    expect(wantsBrowserRendering(null)).toBeNull();
  });
});

describe("T24-RENDER failed responses keep the protocol shape", () => {
  test("a refused preflight becomes a failed scrape with the cursor kept", () => {
    const response = failedScrape(
      { cursor_state: { v: 1, resume_url: null } },
      {
        error_class: "robots_disallowed",
        message: "robots.txt disallows /x",
        url: "https://a.example/x",
      },
      12,
      1000
    );
    expect(response).toMatchObject({
      v: 1,
      outcome: "failed",
      complete: false,
      items: [],
      cursor_state: { v: 1, resume_url: null },
      error: { error_class: "robots_disallowed", http_status: null },
    });
    expect((response.stats as { robots_skipped: number }).robots_skipped).toBe(
      1
    );
  });
});
