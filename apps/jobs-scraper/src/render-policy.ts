// What a Browser Rendering render may load (job-tracker-spec/24 §4.4). Pure
// and unit-tested; src/render.ts applies it to every request of the page.
//
// Blocked: images, fonts and media (not needed to read a listing); analytics
// and tracker hosts (a render must not count as a visitor or write to the
// site's analytics); requests to the site's own host that its robots.txt
// disallows for our crawler; anything that is not http(s) or data/blob; IP
// literals and local host names. Everything else the page needs to show its
// listing (its scripts, its API or search provider) loads as for any visitor.

import type { RobotsRules } from "./robots";
import { robotsAllows } from "./robots";

const BLOCKED_TYPES: ReadonlySet<string> = new Set(["image", "font", "media"]);

/** Analytics, error tracking and tag managers (suffix match on the host). */
export const TRACKER_HOSTS: readonly string[] = [
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "sentry.io",
  "ingest.sentry.io",
  "facebook.net",
  "connect.facebook.net",
  "hotjar.com",
  "hotjar.io",
  "segment.io",
  "segment.com",
  "clarity.ms",
  "mixpanel.com",
  "amplitude.com",
  "heap.io",
  "fullstory.com",
  "intercom.io",
  "firestore.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firebaselogging.googleapis.com",
  "firebase.googleapis.com",
];

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export type BlockReason = "type" | "tracker" | "robots" | "scheme" | "local";

/** Why a request of the render is blocked, or null to let it load. */
export function blockReason(
  requestUrl: string,
  resourceType: string,
  site: { host: string; robots: RobotsRules }
): BlockReason | null {
  if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return "scheme";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "scheme";
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    IPV4_RE.test(host) ||
    host.startsWith("[")
  ) {
    return "local";
  }
  if (BLOCKED_TYPES.has(resourceType)) {
    return "type";
  }
  if (TRACKER_HOSTS.some((suffix) => hostMatches(host, suffix))) {
    return "tracker";
  }
  if (
    host === site.host &&
    !robotsAllows(site.robots, `${url.pathname}${url.search}`)
  ) {
    return "robots";
  }
  return null;
}

interface BrowserSource {
  allow_browser?: unknown;
  strategy?: unknown;
  strategy_config?: unknown;
}

/** A scrape whose listing the Worker renders with Browser Rendering. */
export function wantsBrowserRendering(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const source = (body as { source?: BrowserSource }).source;
  if (
    !source ||
    source.strategy !== "browser" ||
    source.allow_browser !== true ||
    typeof source.strategy_config !== "object" ||
    source.strategy_config === null
  ) {
    return null;
  }
  const config = source.strategy_config as {
    renderer?: unknown;
    url?: unknown;
  };
  return config.renderer === "browser_rendering" &&
    typeof config.url === "string"
    ? config.url
    : null;
}
