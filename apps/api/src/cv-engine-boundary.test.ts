// T8-02: the Worker imports only the worker-safe core of
// @pilihpendidikan/cv-engine. @react-pdf/renderer compiles yoga-layout's WASM
// at runtime, which Workers forbid (08 §1), so neither it nor the React or
// UI-library code around it may enter the api bundle.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENGINE_SRC = new URL("../../../packages/cv-engine/src/", import.meta.url)
  .pathname;
const WORKER_ENTRY = new URL("./index.ts", import.meta.url).pathname;
const FORBIDDEN =
  /@react-pdf\/|yoga-layout|react-dom|\/node_modules\/react\/|react-reconciler|tailwind-merge|packages\/ui\//;
const ENGINE_MODULE = /packages\/cv-engine\/src\//;
const BUNDLE_TIMEOUT_MS = 60_000;
// Bun's bundler through the global: an `import … from "bun"` here makes the
// test program's type check resolve `Headers` to Bun's (api-smoke.test.ts).
const { build } = globalThis.Bun;

/** The source files a bundle of `entry` pulls in, as the bundler sees them. */
async function bundleInputs(entry: string): Promise<string[]> {
  const result = await build({
    entrypoints: [entry],
    target: "browser",
    // Provided by the Workers runtime (nodejs_compat), not bundled.
    external: ["cloudflare:*", "node:*"],
    metafile: true,
    throw: false,
  });
  expect(result.logs.filter((log) => log.level === "error")).toEqual([]);
  expect(result.success).toBe(true);
  return Object.keys(result.metafile?.inputs ?? {});
}

describe("T8-02 the api bundle stays free of the PDF renderer", () => {
  it(
    "T8-02 the Worker bundle uses cv-engine without @react-pdf or yoga-layout",
    async () => {
      const inputs = await bundleInputs(WORKER_ENTRY);
      expect(inputs.some((input) => ENGINE_MODULE.test(input))).toBe(true);
      expect(inputs.filter((input) => FORBIDDEN.test(input))).toEqual([]);
    },
    BUNDLE_TIMEOUT_MS
  );

  it(
    "T8-02 every export of the cv-engine core is worker-safe",
    async () => {
      // Re-export the whole core so tree-shaking keeps every module of it.
      const dir = mkdtempSync(join(tmpdir(), "cv-engine-core-"));
      try {
        const entry = join(dir, "core.ts");
        writeFileSync(entry, `export * from "${ENGINE_SRC}index.ts";\n`);
        const inputs = await bundleInputs(entry);
        // types.ts holds only types, which leave nothing to bundle.
        for (const file of [
          "index.ts",
          "document.ts",
          "schema.ts",
          "markdown.ts",
          "bullets.ts",
          "format.ts",
          "template-utils.ts",
        ]) {
          expect(inputs.some((input) => input.endsWith(file))).toBe(true);
        }
        expect(inputs.filter((input) => FORBIDDEN.test(input))).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    BUNDLE_TIMEOUT_MS
  );

  it(
    "T8-02 the check sees the renderer when the ./pdf subpath is bundled",
    async () => {
      const inputs = await bundleInputs(`${ENGINE_SRC}pdf/index.ts`);
      expect(inputs.some((input) => input.includes("@react-pdf/"))).toBe(true);
      expect(inputs.some((input) => input.includes("yoga-layout"))).toBe(true);
    },
    BUNDLE_TIMEOUT_MS
  );
});
