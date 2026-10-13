#!/usr/bin/env bun
/**
 * CV template parity check.
 *
 * Each CV template has two renderers kept in sync by hand: the @react-pdf
 * document in `packages/cv-engine/src/pdf/<t>-pdf.tsx` and its HTML preview
 * in `apps/cv/src/components/templates/<t>-preview.tsx`. A change set that
 * touches a PDF template must touch its preview too (08 §3.2, apps/cv
 * CLAUDE.md). For an intentional PDF-only fix, set CV_PARITY_OVERRIDE=1.
 *
 *   bun scripts/check-cv-template-parity.ts --files a.tsx,b.tsx
 *   bun scripts/check-cv-template-parity.ts --base origin/main
 *
 * `--base <ref>` takes the files changed since the merge base of <ref> and
 * HEAD, uncommitted and untracked files included. `--root <dir>` runs it
 * against another checkout (the tests use a scratch repository).
 *
 * Exits 1 when a PDF template changed without its preview, 2 on bad usage.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const PDF_TEMPLATE = /^packages\/cv-engine\/src\/pdf\/([a-z0-9-]+)-pdf\.tsx$/;
const LEADING_DOT_SLASH = /^\.\//;
const BACKSLASH = /\\/g;
const OVERRIDE = "CV_PARITY_OVERRIDE";

interface Options {
  base?: string;
  files?: string[];
  root: string;
}

function usage(message: string): never {
  console.error(`check-cv-template-parity: ${message}`);
  console.error(
    "usage: check-cv-template-parity.ts (--files a,b,c | --base <git-ref>) [--root <dir>]"
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { root: resolve(import.meta.dirname, "..") };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      usage(`${flag} needs a value`);
    }
    if (flag === "--files") {
      options.files = value.split(",");
    } else if (flag === "--base") {
      options.base = value;
    } else if (flag === "--root") {
      options.root = resolve(value);
    } else {
      usage(`unknown option ${flag}`);
    }
  }
  if (Boolean(options.files) === Boolean(options.base)) {
    usage("pass exactly one of --files and --base");
  }
  return options;
}

function git(root: string, args: string[]): string[] {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    usage(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split("\n");
}

function changedSince(root: string, base: string): string[] {
  return [
    ...git(root, ["diff", "--name-only", "--merge-base", base]),
    ...git(root, ["ls-files", "--others", "--exclude-standard"]),
  ];
}

function normalize(file: string): string {
  return file.trim().replace(BACKSLASH, "/").replace(LEADING_DOT_SLASH, "");
}

/** The PDF templates changed without their preview, as [pdf, preview]. */
export function findParityViolations(files: string[]): [string, string][] {
  const changed = new Set(files.map(normalize).filter(Boolean));
  const violations: [string, string][] = [];
  for (const file of [...changed].sort()) {
    const template = PDF_TEMPLATE.exec(file)?.[1];
    if (!template) {
      continue;
    }
    const preview = `apps/cv/src/components/templates/${template}-preview.tsx`;
    if (!changed.has(preview)) {
      violations.push([file, preview]);
    }
  }
  return violations;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const files =
    options.files ?? changedSince(options.root, options.base ?? "HEAD");
  const violations = findParityViolations(files);

  if (violations.length === 0) {
    console.log(
      "CV template parity: every changed PDF template has its preview."
    );
    process.exit(0);
  }

  for (const [pdf, preview] of violations) {
    console.error(`${pdf} changed without ${preview}`);
  }
  if (process.env[OVERRIDE] === "1") {
    console.warn(`${OVERRIDE}=1: accepted as an intentional PDF-only change.`);
    process.exit(0);
  }
  console.error(
    `CV template parity failed: change each preview with its PDF template, or set ${OVERRIDE}=1 for an intentional PDF-only fix.`
  );
  process.exit(1);
}
