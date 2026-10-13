// TCV-PARITY: scripts/check-cv-template-parity.ts fails a change set that
// touches packages/cv-engine/src/pdf/<t>-pdf.tsx without apps/cv's
// templates/<t>-preview.tsx, unless CV_PARITY_OVERRIDE=1.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "bun";

const SCRIPT = new URL(
  "../../../scripts/check-cv-template-parity.ts",
  import.meta.url
).pathname;
const PDF = "packages/cv-engine/src/pdf/basic-pdf.tsx";
const PREVIEW = "apps/cv/src/components/templates/basic-preview.tsx";
const SCRATCH_TIMEOUT_MS = 20_000;

function runParity(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync([process.execPath, SCRIPT, ...args], {
    env: { ...process.env, CV_PARITY_OVERRIDE: "", ...env },
  });
  return {
    code: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("TCV-PARITY with --files", () => {
  it("TCV-PARITY fails a PDF template changed without its preview", () => {
    const run = runParity(["--files", `${PDF},README.md`]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`${PDF} changed without ${PREVIEW}`);
  });

  it("TCV-PARITY passes a PDF template changed with its preview", () => {
    expect(runParity(["--files", `${PREVIEW},${PDF}`]).code).toBe(0);
  });

  it("TCV-PARITY names every template missing its preview", () => {
    const run = runParity([
      "--files",
      [
        PDF,
        PREVIEW,
        "packages/cv-engine/src/pdf/harvard-pdf.tsx",
        "./packages/cv-engine/src/pdf/standard-pdf.tsx",
      ].join(","),
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("harvard-preview.tsx");
    expect(run.stderr).toContain("standard-preview.tsx");
    expect(run.stderr).not.toContain("basic-preview.tsx changed");
  });

  it("TCV-PARITY ignores other files, previews alone and engine code", () => {
    const files = [
      PREVIEW,
      "packages/cv-engine/src/pdf/cv-document.tsx",
      "packages/cv-engine/src/template-utils.ts",
    ];
    expect(runParity(["--files", files.join(",")]).code).toBe(0);
  });

  it("TCV-PARITY accepts an intentional PDF-only fix with the override", () => {
    const run = runParity(["--files", PDF], { CV_PARITY_OVERRIDE: "1" });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("CV_PARITY_OVERRIDE=1");
  });

  it("TCV-PARITY rejects bad usage", () => {
    expect(runParity([]).code).toBe(2);
    expect(runParity(["--files", PDF, "--base", "HEAD"]).code).toBe(2);
    expect(runParity(["--nope", "x"]).code).toBe(2);
  });
});

describe("TCV-PARITY with --base", () => {
  const root = mkdtempSync(join(tmpdir(), "cv-parity-"));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function git(...args: string[]): void {
    const result = spawnSync(["git", ...args], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });
    expect(result.exitCode).toBe(0);
  }

  function write(file: string, content: string): void {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }

  it(
    "TCV-PARITY checks commits and uncommitted changes since a base ref",
    () => {
      git("init", "--quiet", "--initial-branch=main");
      write(PDF, "v1");
      write(PREVIEW, "v1");
      git("add", ".");
      git("commit", "--quiet", "-m", "base");
      git("checkout", "--quiet", "-b", "change");

      const base = ["--base", "main", "--root", root];
      expect(runParity(base).code).toBe(0);

      write(PDF, "v2");
      git("commit", "--quiet", "-am", "pdf only");
      const committed = runParity(base);
      expect(committed.code).toBe(1);
      expect(committed.stderr).toContain(PREVIEW);

      // Fixed in the working tree, not yet committed.
      write(PREVIEW, "v2");
      expect(runParity(base).code).toBe(0);

      // A new template without a preview, still untracked.
      write("packages/cv-engine/src/pdf/modern-pdf.tsx", "new");
      const untracked = runParity(base);
      expect(untracked.code).toBe(1);
      expect(untracked.stderr).toContain("modern-preview.tsx");
    },
    SCRATCH_TIMEOUT_MS
  );
});
