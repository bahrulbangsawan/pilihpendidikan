#!/usr/bin/env bun
/**
 * Design page coverage check.
 *
 * Every component file in `packages/ui/src/{ui,blocks,form,reui}` must be
 * rendered somewhere on the design system page (`apps/design/src`): a
 * showcase file has to import it as `@rulisme/ui/<folder>/<file>`. A component nobody can see is a component nobody
 * reviews. Adapted from the shadcn skill's `showcase-coverage.mjs`.
 *
 * Exits 1 when a component is missing. See DESIGN.md § Implementation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const UI_SRC = resolve(ROOT, "packages/ui/src");
// Folders of rendered components: primitives, composites (blocks), composed
// form pieces and the reui ports. `lib`, `hooks`, `print` and `styles` hold
// no components.
const COMPONENT_DIRS = ["ui", "blocks", "form", "reui"];
const SHOWCASE_DIR = resolve(ROOT, "apps/design/src");
const SOURCE_FILE = /\.(tsx?|jsx?)$/;
const COMPONENT_FILE = new Set([".ts", ".tsx"]);

function walk(path: string): string[] {
  if (statSync(path).isFile()) {
    return [path];
  }
  return readdirSync(path).flatMap((entry) =>
    entry === "node_modules" ? [] : walk(join(path, entry))
  );
}

const TEST_FILE = /\.test\.tsx?$/;
const components = COMPONENT_DIRS.flatMap((dir) => {
  const path = resolve(UI_SRC, dir);
  try {
    return readdirSync(path)
      .filter(
        (file) => COMPONENT_FILE.has(extname(file)) && !TEST_FILE.test(file)
      )
      .map((file) => `${dir}/${basename(file, extname(file))}`);
  } catch {
    return [];
  }
}).sort();

const source = walk(SHOWCASE_DIR)
  .filter((file) => SOURCE_FILE.test(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const missing = components.filter(
  (name) => !source.includes(`@rulisme/ui/${name}"`)
);

if (missing.length === 0) {
  console.log(
    `✓ Design page coverage: ${components.length}/${components.length} components shown.`
  );
  process.exit(0);
}

console.error(
  `✗ Design page coverage: ${components.length - missing.length}/${components.length} components shown.`
);
console.error(`  Missing: ${missing.join(", ")}`);
console.error(
  "\nFix: render each missing component in apps/design/src/showcase/sections/ (import it as @rulisme/ui/<folder>/<file>)."
);
process.exit(1);
