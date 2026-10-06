import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "tinyglobby";
import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL("./src/", import.meta.url));
const sourceExtension = /\.tsx?$/;
const entry = Object.fromEntries(
  globSync(["**/*.tsx", "**/*.ts"], { cwd: sourceRoot }).map((file) => [
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
