// Semantic versions (semver.org §11 precedence), enough to compare a device's
// CLI version with `GET /api/v1/meta` min / recommended (12 §7, 22 §6).

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers; empty for a release. */
  prerelease: readonly string[];
}

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_RE = /^\d+$/;

/** The parsed version, or null when `text` is not semver. */
export function parseSemver(text: string): Semver | null {
  const found = SEMVER_RE.exec(text.trim());
  if (!found) {
    return null;
  }
  return {
    major: Number(found[1]),
    minor: Number(found[2]),
    patch: Number(found[3]),
    prerelease: found[4] ? found[4].split(".") : [],
  };
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = NUMERIC_RE.test(a);
  const bNumeric = NUMERIC_RE.test(b);
  if (aNumeric && bNumeric) {
    return Math.sign(Number(a) - Number(b));
  }
  if (aNumeric !== bNumeric) {
    return aNumeric ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    // A release outranks any pre-release of the same version.
    return Math.sign(b.length - a.length);
  }
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = compareIdentifier(a[index] ?? "", b[index] ?? "");
    if (order !== 0) {
      return order;
    }
  }
  return Math.sign(a.length - b.length);
}

/** -1, 0 or 1; null when either side is not a semver. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!(left && right)) {
    return null;
  }
  const order =
    Math.sign(left.major - right.major) ||
    Math.sign(left.minor - right.minor) ||
    Math.sign(left.patch - right.patch) ||
    comparePrerelease(left.prerelease, right.prerelease);
  return order as -1 | 0 | 1;
}

/** True when `version` is strictly older than `floor`. */
export function isOlderThan(version: string, floor: string): boolean {
  return compareSemver(version, floor) === -1;
}
