import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "tinyglobby";
import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL("./src/", import.meta.url));
const sourceExtension = /\.tsx?$/;
// print/ embeds the font files the builders' PDFs use; the apps compile it
// from source like the rest of the package, and the library build leaves it
// out rather than inline the fonts into dist.
const entry = Object.fromEntries(
  globSync(
    ["**/*.tsx", "**/*.ts", "!**/*.test.ts", "!**/*.test.tsx", "!print/**"],
    { cwd: sourceRoot }
  ).map((file) => [
    file.replace(sourceExtension, ""),
    resolve(sourceRoot, file),
  ])
);

export default defineConfig({
  build: {
    // Production passes --emptyOutDir; watch must preserve tsc's declarations.
    emptyOutDir: false,
    outDir: "dist",
    minify: false,
    sourcemap: false,
    target: "esnext",
    lib: {
      entry,
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: (id) =>
        !(id.startsWith(".") || isAbsolute(id) || id.startsWith("\0")),
    },
  },
});
