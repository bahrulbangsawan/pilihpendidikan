#!/usr/bin/env bun
/**
 * Theme parity check — Zedative design system.
 *
 * Every token and type utility lives in one file,
 * `packages/ui/src/styles/theme.css` (`@rulisme/ui/styles/theme.css`). This
 * check keeps it that way: each UI app's `src/styles.css` must import the
 * shared theme and must not define tokens of its own — no `@theme` block, no
 * `--font-*` / `--text-*` / `--leading-*` / `--tracking-*` / `--color-*` /
 * `--radius-*` / `--shadow-*` declarations, no `type-*` / `weight-*`
 * utilities and no second `dark` variant. Print-artifact rules (`.cv-page`,
 * `.pf-*`) may re-scope semantic variables such as `--foreground`; those are
 * not tokens. Exits 1 on drift. See TYPOGRAPHY.md.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const THEME_IMPORT = /@import\s+["']@rulisme\/ui\/styles\/theme\.css["']/;
const COMMENT = /\/\*[\s\S]*?\*\//g;

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: "@theme block", pattern: /@theme\b/ },
  {
    label: "token declaration",
    pattern:
      /(^|[\s;{])--(font|text|leading|tracking|color|radius|shadow|inset-shadow)-[\w-]*\s*:/m,
  },
  { label: "type-* / weight-* utility", pattern: /@utility\s+(type|weight)-/ },
  { label: "dark variant", pattern: /@custom-variant\s+dark\b/ },
];

// UI apps that must have a src/styles.css importing the theme. Any other app
// with a styles.css is checked too (apps/api has none).
const REQUIRED_APPS = [
  "apps/home",
  "apps/cv",
  "apps/invoice",
  "apps/portfolio",
  "apps/jobs",
  "apps/design",
];

const apps = readdirSync(resolve(ROOT, "apps"))
  .map((name) => ({
    app: `apps/${name}`,
    path: resolve(ROOT, "apps", name, "src/styles.css"),
  }))
  .filter((entry) => existsSync(entry.path));

const failures: string[] = [];

for (const app of REQUIRED_APPS) {
  if (!existsSync(resolve(ROOT, app, "src/styles.css"))) {
    failures.push(`${app}: has no src/styles.css importing the shared theme`);
  }
}

for (const { app, path } of apps) {
  const css = readFileSync(path, "utf8").replace(COMMENT, "");
  if (!THEME_IMPORT.test(css)) {
    failures.push(
      `${app}: does not import "@rulisme/ui/styles/theme.css" (src/styles.css)`
    );
  }
  for (const { label, pattern } of FORBIDDEN) {
    const match = css.match(pattern);
    if (match) {
      failures.push(
        `${app}: defines its own ${label} (${match[0].trim()}) in src/styles.css`
      );
    }
  }
}

if (failures.length === 0) {
  console.log(
    `✓ Theme parity: ${apps.length} apps import @rulisme/ui/styles/theme.css and define no tokens.`
  );
  process.exit(0);
}

console.error("✗ Theme parity check FAILED.");
for (const failure of failures) {
  console.error(`  - ${failure}`);
}
console.error(
  "\nFix: import the shared theme and move any token into packages/ui/src/styles/theme.css. See TYPOGRAPHY.md."
);
process.exit(1);
