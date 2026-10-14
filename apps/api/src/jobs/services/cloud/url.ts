// Source URL validation for the cloud catalog (24 §8). The api never fetches
// these URLs itself; it refuses anything the scraper would refuse before a
// row exists: non-http(s) schemes, userinfo, non-default ports, IP literals,
// local and internal host names, and the D-17 excluded platforms. The
// scraper repeats the check with DNS resolution before every fetch (SSRF).

import {
  asciiHost,
  registrableDomain,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import { checkUrl, excludedHostOf } from "../discovery/validation";

export type CloudUrlProblem =
  | "malformed"
  | "scheme"
  | "userinfo"
  | "length"
  | "port"
  | "ip_literal"
  | "local_host"
  | "excluded";

export interface CloudUrlOk {
  /** Registrable domain (catalog dedupe key). */
  domain: string;
  host: string;
  ok: true;
  /** Normalized href (fragment removed). */
  url: string;
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const TRAILING_DOT_RE = /\.$/;
const LOCAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".test",
  ".invalid",
  ".example",
];

function isLocalHost(host: string): boolean {
  if (host === "localhost" || !host.includes(".")) {
    return true;
  }
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const MESSAGES: Record<CloudUrlProblem, string> = {
  malformed: "The URL is not valid.",
  scheme: "Only http and https URLs can be registered.",
  userinfo: "URLs with a user name or password are refused.",
  length: "The URL is longer than 2048 characters.",
  port: "Only the default ports (80 and 443) are allowed.",
  ip_literal: "Register the site by its host name, not an IP address.",
  local_host: "Local and internal host names cannot be registered.",
  excluded:
    "This platform is excluded from automated discovery by its terms (D-17).",
};

export function cloudUrlMessage(problem: CloudUrlProblem): string {
  return MESSAGES[problem];
}

/** Checks a URL an operator registers (or a directory entry). */
export function validateCloudUrl(
  raw: string
): CloudUrlOk | { ok: false; problem: CloudUrlProblem } {
  const syntax = checkUrl(raw, { allowHttp: true });
  if (syntax) {
    return { ok: false, problem: syntax };
  }
  const url = new URL(raw);
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    return { ok: false, problem: "port" };
  }
  const host = asciiHost(url.hostname)?.replace(TRAILING_DOT_RE, "") ?? "";
  if (host === "") {
    return { ok: false, problem: "malformed" };
  }
  if (IPV4_RE.test(host) || host.startsWith("[") || host.includes(":")) {
    return { ok: false, problem: "ip_literal" };
  }
  if (isLocalHost(host)) {
    return { ok: false, problem: "local_host" };
  }
  if (excludedHostOf(url.href)) {
    return { ok: false, problem: "excluded" };
  }
  url.hash = "";
  return {
    ok: true,
    url: url.href,
    host,
    domain: registrableDomain(host) ?? host,
  };
}

/** The catalog slug of a URL: its registrable domain. */
export function slugForUrl(raw: string): string | null {
  const checked = validateCloudUrl(raw);
  return checked.ok ? checked.domain : null;
}
