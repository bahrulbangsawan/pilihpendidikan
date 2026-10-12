#!/usr/bin/env bun
/**
 * tailwind-merge typography-config parity check.
 *
 * `cn()` (`packages/ui/src/lib/utils.ts`, imported by every app as
 * `@rulisme/ui/lib/utils`) registers the Zedative type utilities with
 * tailwind-merge: the `type-role` group (`type-body`, `type-title-compact`,
 * …) and the `type-weight` group (`weight-semibold`, …), both fed from
 * `TYPE_UTILITIES` / `TYPE_WEIGHTS` in `packages/ui/src/lib/type-scale.ts`.
 * If a utility is added to `theme.css` but not to those lists, `cn()` stops
 * resolving conflicts for it; if a list names a utility the theme no longer
 * defines, `typeClass()` returns a class that renders nothing.
 *
 * This script asserts the lists match the `@utility type-*` and
 * `@utility weight-*` blocks in `packages/ui/src/styles/theme.css`, that
 * `utils.ts` registers both lists, and that no app ships its own `cn()`.
 * Exits 1 on drift. See TYPOGRAPHY.md.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TYPE_UTILITIES,
  TYPE_WEIGHTS,
} from "../packages/ui/src/lib/type-scale";

const ROOT = resolve(import.meta.dirname, "..");
const THEME = resolve(ROOT, "packages/ui/src/styles/theme.css");
const UTILS = resolve(ROOT, "packages/ui/src/lib/utils.ts");

const ROLE_UTILITY = /@utility\s+type-([a-z-]+)\s*\{/g;
const WEIGHT_UTILITY = /@utility\s+weight-([a-z-]+)\s*\{/g;

const theme = readFileSync(THEME, "utf8");
const definedRoles = [...theme.matchAll(ROLE_UTILITY)]
  .map((match) => match[1] ?? "")
  .sort();
const definedWeights = [...theme.matchAll(WEIGHT_UTILITY)]
  .map((match) => match[1] ?? "")
  .sort();

function diff(expected: readonly string[], actual: readonly string[]) {
  const actualSet = new Set(actual);
  return expected.filter((name) => !actualSet.has(name));
}

const failures: string[] = [];

const listedRoles = [...TYPE_UTILITIES].sort();
const listedWeights = [...TYPE_WEIGHTS].sort();

for (const name of diff(definedRoles, listedRoles)) {
  failures.push(
    `type-${name} is defined in theme.css but not in TYPE_UTILITIES`
  );
}
for (const name of diff(listedRoles, definedRoles)) {
  failures.push(
    `type-${name} is in TYPE_UTILITIES but not defined in theme.css`
  );
}
for (const name of diff(definedWeights, listedWeights)) {
  failures.push(
    `weight-${name} is defined in theme.css but not in TYPE_WEIGHTS`
  );
}
for (const name of diff(listedWeights, definedWeights)) {
  failures.push(
    `weight-${name} is in TYPE_WEIGHTS but not defined in theme.css`
  );
}

const utils = readFileSync(UTILS, "utf8");
if (
  !/"type-role"\s*:\s*\[\s*\{\s*type\s*:\s*TYPE_UTILITIES\s*\}\s*\]/.test(utils)
) {
  failures.push(
    'utils.ts does not register `"type-role": [{ type: TYPE_UTILITIES }]`'
  );
}
if (
  !/"type-weight"\s*:\s*\[\s*\{\s*weight\s*:\s*\[\s*\.\.\.TYPE_WEIGHTS\s*\]\s*\}\s*\]/.test(
    utils
  )
) {
  failures.push(
    'utils.ts does not register `"type-weight": [{ weight: [...TYPE_WEIGHTS] }]`'
  );
}

for (const app of readdirSync(resolve(ROOT, "apps"))) {
  const localUtils = resolve(ROOT, "apps", app, "src/lib/utils.ts");
  if (
    existsSync(localUtils) &&
    /extendTailwindMerge|twMerge/.test(readFileSync(localUtils, "utf8"))
  ) {
    failures.push(
      `apps/${app}/src/lib/utils.ts ships its own tailwind-merge; import cn from @rulisme/ui/lib/utils`
    );
  }
}

if (failures.length === 0) {
  console.log(
    `✓ cn() registers ${definedRoles.length} type-* roles and ${definedWeights.length} weight-* utilities (matches theme.css).`
  );
  process.exit(0);
}

console.error("✗ tailwind-merge typography-config drift detected.");
for (const failure of failures) {
  console.error(`  - ${failure}`);
}
console.error(
  "\nFix: keep TYPE_UTILITIES / TYPE_WEIGHTS in packages/ui/src/lib/type-scale.ts in step with the @utility blocks in packages/ui/src/styles/theme.css. See TYPOGRAPHY.md."
);
process.exit(1);
