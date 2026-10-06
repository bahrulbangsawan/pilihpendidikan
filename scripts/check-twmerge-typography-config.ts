#!/usr/bin/env bun
/**
 * tailwind-merge typography-config parity check.
 *
 * The apps don't ship their own `cn()`: apps/cv, apps/invoice, apps/portfolio
 * and apps/home all import it from `@rulisme/ui/lib/utils`
 * (`packages/ui/src/lib/utils.ts`), which extends `tailwind-merge` so it knows
 * the custom Warp typography utilities live in the `font-size` group. If a new
 * `--text-*` size is added to an app's `@theme inline` but not registered in
 * that `cn()`, twMerge falls back to its default rules and silently strips the
 * class whenever it collides with a `text-*` colour — the element renders at
 * the inherited size with no warning.
 *
 * This script extracts every custom font-size and tracking token from each
 * app's `styles.css` and asserts that the `cn()` the app uses registers all of
 * them.
 *
 * Exits 1 on drift. See TYPOGRAPHY.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface App {
  name: string;
  cssPath: string;
  utilsPath: string;
}

const ROOT = resolve(import.meta.dirname, "..");

// Apps resolve `cn()` from the shared @rulisme/ui package. An app that adds
// its own `src/lib/utils.ts` is checked against that file instead.
const SHARED_UTILS = resolve(ROOT, "packages/ui/src/lib/utils.ts");

const APPS: App[] = ["cv", "invoice", "portfolio", "home"].map((app) => {
  const localUtils = resolve(ROOT, `apps/${app}/src/lib/utils.ts`);
  return {
    name: `apps/${app}`,
    cssPath: resolve(ROOT, `apps/${app}/src/styles.css`),
    utilsPath: existsSync(localUtils) ? localUtils : SHARED_UTILS,
  };
});

const THEME_INLINE_BLOCK_PATTERN = /@theme\s+inline\s*\{([\s\S]*?)\n\}/;

// Matches `--text-<name>: <value>;` but excludes the paired
// `--text-<name>--line-height` and `--text-<name>--letter-spacing` rows. The
// Warp scale bakes letter-spacing into each size token via the
// `--letter-spacing` suffix, so that suffix must be excluded here too or it
// would be mis-read as a separate font-size name.
const TEXT_SIZE_PATTERN = /^--text-([a-z0-9-]+):/;
const TRACKING_PATTERN = /^--tracking-([a-z0-9-]+):/;
const TEXT_COLOR_PATTERN = /^--color-text-([a-z0-9-]+):/;

interface ThemeTokens {
  fontSizes: string[];
  trackings: string[];
  textColors: string[];
}

function extractTokens(css: string): ThemeTokens {
  const body = css.match(THEME_INLINE_BLOCK_PATTERN)?.[1];
  if (body === undefined) {
    throw new Error("No `@theme inline { … }` block found");
  }
  const lines = body.split("\n").map((line) => line.trim());

  const fontSizes: string[] = [];
  const trackings: string[] = [];
  const textColors: string[] = [];

  for (const line of lines) {
    const sizeName = line.match(TEXT_SIZE_PATTERN)?.[1];
    if (
      sizeName !== undefined &&
      !line.includes("--line-height") &&
      !line.includes("--letter-spacing")
    ) {
      fontSizes.push(sizeName);
      continue;
    }
    const trackingName = line.match(TRACKING_PATTERN)?.[1];
    if (trackingName !== undefined) {
      trackings.push(trackingName);
      continue;
    }
    const colorName = line.match(TEXT_COLOR_PATTERN)?.[1];
    if (colorName !== undefined) {
      textColors.push(colorName);
    }
  }

  return {
    fontSizes: fontSizes.sort(),
    trackings: trackings.sort(),
    textColors: textColors.sort(),
  };
}

// Extracts the array of names registered under a given group inside the
// `extendTailwindMerge({ extend: { classGroups: { … } } })` config in utils.ts.
// The structure looked at is:
//   <group>: [
//     {
//       <prefix>: ["name1", "name2", ...]
//     }
//   ],
// where <group> can appear bare (`tracking`) or quoted (`"font-size"`), and
// <prefix> is the Tailwind class prefix the names are appended to.
function extractRegisteredNames(utilsSource: string, group: string): string[] {
  const groupKeyPattern = new RegExp(
    `(?:["']${group}["']|\\b${group})\\s*:\\s*\\[`
  );
  const groupMatch = utilsSource.match(groupKeyPattern);
  if (!groupMatch || groupMatch.index === undefined) {
    throw new Error(`Group "${group}" not registered in utils.ts`);
  }
  // Move past the group key and the opening `[` so we don't accidentally pick
  // up the group name itself when it matches the inner prefix (e.g. `tracking`).
  const afterGroup = utilsSource.slice(groupMatch.index + groupMatch[0].length);
  const prefix = group === "font-size" ? "text" : "tracking";
  const arrayPattern = new RegExp(`\\b${prefix}\\s*:\\s*\\[([\\s\\S]*?)\\]`);
  const names = afterGroup.match(arrayPattern)?.[1];
  if (names === undefined) {
    throw new Error(
      `Could not find ${prefix}: [...] block under "${group}" in utils.ts`
    );
  }
  return names
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0)
    .sort();
}

function diff(expected: string[], actual: string[]): string[] {
  const actualSet = new Set(actual);
  return expected.filter((name) => !actualSet.has(name));
}

let failed = false;
const reports: string[] = [];

for (const app of APPS) {
  const css = readFileSync(app.cssPath, "utf8");
  const utils = readFileSync(app.utilsPath, "utf8");
  const tokens = extractTokens(css);
  const registeredSizes = extractRegisteredNames(utils, "font-size");
  // The Warp scale bakes letter-spacing into each size token, so it
  // registers no standalone tracking utilities. Only assert the tracking group
  // when the app actually defines `--tracking-*` tokens in @theme inline.
  const registeredTrackings =
    tokens.trackings.length > 0
      ? extractRegisteredNames(utils, "tracking")
      : [];

  const missingSizes = diff(tokens.fontSizes, registeredSizes);
  const extraSizes = diff(registeredSizes, tokens.fontSizes);
  const missingTrackings = diff(tokens.trackings, registeredTrackings);
  const extraTrackings = diff(registeredTrackings, tokens.trackings);

  if (
    missingSizes.length === 0 &&
    extraSizes.length === 0 &&
    missingTrackings.length === 0 &&
    extraTrackings.length === 0
  ) {
    reports.push(
      `[32m✓[0m ${app.name}: cn() registers ${registeredSizes.length} font-size + ${registeredTrackings.length} tracking tokens (matches @theme inline).`
    );
    continue;
  }

  failed = true;
  const lines: string[] = [`[31m✗[0m ${app.name}: drift`];
  if (missingSizes.length > 0) {
    lines.push(
      `    font-size tokens defined in styles.css but NOT registered in utils.ts: ${missingSizes.join(", ")}`
    );
  }
  if (extraSizes.length > 0) {
    lines.push(
      `    font-size tokens registered in utils.ts but NOT defined in styles.css: ${extraSizes.join(", ")}`
    );
  }
  if (missingTrackings.length > 0) {
    lines.push(
      `    tracking tokens defined in styles.css but NOT registered in utils.ts: ${missingTrackings.join(", ")}`
    );
  }
  if (extraTrackings.length > 0) {
    lines.push(
      `    tracking tokens registered in utils.ts but NOT defined in styles.css: ${extraTrackings.join(", ")}`
    );
  }
  reports.push(lines.join("\n"));
}

console.log(reports.join("\n"));
if (failed) {
  console.error(
    "\n[31mtailwind-merge typography-config drift detected.[0m\nFix: update the `extendTailwindMerge({ extend: { classGroups: … } })` block in the utils.ts the app uses (packages/ui/src/lib/utils.ts by default) so it lists every font-size and tracking token defined in `@theme inline`. See TYPOGRAPHY.md."
  );
  process.exit(1);
}
process.exit(0);
