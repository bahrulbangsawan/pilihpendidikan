#!/usr/bin/env bun
/**
 * Typography parity check — Warp design-system family.
 *
 * Verifies the typography portion of the `@theme inline { … }` block is
 * byte-identical across the three apps that share the Warp "moonlit terminal"
 * design system: apps/cv (canonical source of truth), apps/invoice and
 * apps/portfolio. The check covers font-size + line-height tokens, tracking
 * tokens, standalone leading tokens, font-family tokens, and font-weight
 * tokens. Exits 1 on drift. See DESIGN.md / TYPOGRAPHY.md.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Source {
  app: string;
  path: string;
}

const ROOT = resolve(import.meta.dirname, "..");

const SOURCES: Source[] = [
  { app: "apps/cv", path: resolve(ROOT, "apps/cv/src/styles.css") },
  { app: "apps/invoice", path: resolve(ROOT, "apps/invoice/src/styles.css") },
  {
    app: "apps/portfolio",
    path: resolve(ROOT, "apps/portfolio/src/styles.css"),
  },
];

const TYPOGRAPHY_TOKEN_PREFIXES = [
  "--font-sans",
  "--font-serif",
  "--font-mono",
  "--font-weight-",
  "--text-",
  "--tracking-",
  "--leading-",
] as const;

const THEME_INLINE_BLOCK_PATTERN = /@theme\s+inline\s*\{([\s\S]*?)\n\}/;

function extractTypographyTokens(css: string): string {
  const body = css.match(THEME_INLINE_BLOCK_PATTERN)?.[1];
  if (body === undefined) {
    throw new Error("No `@theme inline { … }` block found");
  }
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line.startsWith("--")) {
        return false;
      }
      return TYPOGRAPHY_TOKEN_PREFIXES.some((prefix) =>
        line.startsWith(prefix)
      );
    })
    .sort();
  return lines.join("\n");
}

const blocks = SOURCES.map((source) => {
  const css = readFileSync(source.path, "utf8");
  return { ...source, tokens: extractTypographyTokens(css) };
});

const reference = blocks[0];
if (reference === undefined) {
  throw new Error("Typography parity requires a reference source");
}
const drift = blocks.slice(1).filter((b) => b.tokens !== reference.tokens);

if (drift.length === 0) {
  console.log(
    `✓ Typography parity: ${SOURCES.length} apps match (${reference.tokens.split("\n").length} tokens).`
  );
  process.exit(0);
}

console.error("✗ Typography parity check FAILED.");
console.error(`Reference: ${reference.app} (${reference.path})`);
for (const b of drift) {
  console.error(`\nDrift in ${b.app} (${b.path}):`);
  const refLines = new Set(reference.tokens.split("\n"));
  const bLines = new Set(b.tokens.split("\n"));
  for (const line of refLines) {
    if (!bLines.has(line)) {
      console.error(`  - missing: ${line}`);
    }
  }
  for (const line of bLines) {
    if (!refLines.has(line)) {
      console.error(`  - extra:   ${line}`);
    }
  }
}
console.error(
  "\nFix: mirror the typography token changes across every app's styles.css. See TYPOGRAPHY.md."
);
process.exit(1);
