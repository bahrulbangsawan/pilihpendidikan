// API version and CLI compatibility (05 §1.7, 22).
//
// The CLI sends `X-Pilih-Client: cli/<semver>`. A version below the var
// `JOBS_MIN_CLI_VERSION` gets `426 cli_upgrade_required` on every /api/v1
// route except `/api/v1/meta` (the OAuth, logout and revocation endpoints are
// outside /api/v1 and never gated). Requests without the header (the web BFF,
// scripts, MCP) are not version-gated.
//
// Gate rule: only the numeric `major.minor.patch` core is compared, so a
// pre-release or local build of the minimum version (`0.1.0-rc.1`,
// PEP 440 `0.1.0.dev3`) is accepted. A `cli/` header whose version cannot be
// read is treated as too old (fail closed). `compareSemver` itself follows
// SemVer 2.0 precedence for everything else.

import type { Env } from "../../env";

export const API_VERSION = "v1";
export const CLIENT_HEADER = "X-Pilih-Client";
export const DEFAULT_MIN_CLI_VERSION = "0.1.0";

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers (SemVer) or null. */
  prerelease: string | null;
}

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
// Leading numeric core of anything version-like ("0.1.0.dev3", "1.2.3rc1").
const CORE_RE = /^v?(\d+)\.(\d+)\.(\d+)/;
const NUMERIC_RE = /^\d+$/;

/** Strict SemVer 2.0 parse; null when not a SemVer. */
export function parseSemver(value: string): Semver | null {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** The numeric core of a version-like string; null when there is none. */
export function parseVersionCore(value: string): Semver | null {
  const match = CORE_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: null,
  };
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC_RE.test(a);
  const bNumeric = NUMERIC_RE.test(b);
  if (aNumeric && bNumeric) {
    return Math.sign(Number(a) - Number(b));
  }
  if (aNumeric) {
    return -1;
  }
  if (bNumeric) {
    return 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) {
      return -1;
    }
    if (right[i] === undefined) {
      return 1;
    }
    const order = compareIdentifiers(left[i], right[i]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** SemVer 2.0 precedence: negative, zero or positive. */
export function compareSemver(a: Semver, b: Semver): number {
  return (
    Math.sign(a.major - b.major) ||
    Math.sign(a.minor - b.minor) ||
    Math.sign(a.patch - b.patch) ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

export type ClientInfo =
  | { kind: "cli"; version: string; core: Semver | null }
  | { kind: "other"; value: string };

/** Parses `X-Pilih-Client`; null when the header is absent. */
export function parseClientHeader(value: string | null): ClientInfo | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("cli/")) {
    const version = trimmed.slice(4);
    return { kind: "cli", version, core: parseVersionCore(version) };
  }
  return { kind: "other", value: trimmed };
}

export interface CliVersions {
  min: string;
  recommended: string;
}

export function cliVersions(
  env: Pick<Env, "JOBS_MIN_CLI_VERSION" | "JOBS_RECOMMENDED_CLI_VERSION">
): CliVersions {
  const min = env.JOBS_MIN_CLI_VERSION?.trim() || DEFAULT_MIN_CLI_VERSION;
  const recommended = env.JOBS_RECOMMENDED_CLI_VERSION?.trim() || min;
  return { min, recommended };
}

/** True when a CLI client must upgrade before using /api/v1 (S-32). */
export function cliUpgradeRequired(
  client: ClientInfo | null,
  minVersion: string
): boolean {
  if (client?.kind !== "cli") {
    return false;
  }
  const min = parseVersionCore(minVersion);
  if (!min) {
    return false;
  }
  if (!client.core) {
    return true;
  }
  return compareSemver(client.core, min) < 0;
}
