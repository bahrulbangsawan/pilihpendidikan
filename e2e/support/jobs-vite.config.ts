// Vite config for running apps/jobs against the e2e api. It is apps/jobs'
// own config (same plugins, same root) except that the Cloudflare plugin reads
// a generated Worker config whose `.dev.vars` point the BFF at the e2e api
// (`JOBS_API_FALLBACK_URL`) — the developer's apps/jobs/.dev.vars is never
// read or modified. `E2E_JOBS_WRANGLER_CONFIG` names that generated file.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const webDir = resolve(import.meta.dirname, "../../apps/jobs");

type ExportEntry = string | { [condition: string]: ExportEntry };

function pickImport(entry: ExportEntry): string {
  if (typeof entry === "string") {
    return entry;
  }
  const next = entry.import ?? entry.default ?? entry.node;
  if (next === undefined) {
    throw new Error(`no import condition in ${JSON.stringify(entry)}`);
  }
  return pickImport(next);
}

/** ESM entry of a package installed for apps/jobs (its `exports` map, `import`). */
async function load<T>(pkg: string, subpath = "."): Promise<T> {
  const dir = join(webDir, "node_modules", pkg);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const exportsMap = manifest.exports as
    | Record<string, ExportEntry>
    | undefined;
  const entry =
    exportsMap?.[subpath] ??
    (subpath === "." ? (manifest.module ?? manifest.main) : undefined);
  if (entry === undefined) {
    throw new Error(`${pkg} exports no ${subpath}`);
  }
  return (await import(pathToFileURL(join(dir, pickImport(entry))).href)) as T;
}

const wranglerConfig = process.env.E2E_JOBS_WRANGLER_CONFIG;
if (!wranglerConfig) {
  throw new Error("E2E_JOBS_WRANGLER_CONFIG is not set");
}

const { cloudflare } = await load<{
  cloudflare: (options: Record<string, unknown>) => unknown;
}>("@cloudflare/vite-plugin");
const { tanstackStart } = await load<{ tanstackStart: () => unknown }>(
  "@tanstack/react-start",
  "./plugin/vite"
);
const tailwindcss = (
  await load<{ default: () => unknown }>("@tailwindcss/vite")
).default;
const viteReact = (
  await load<{ default: () => unknown }>("@vitejs/plugin-react")
).default;

export default {
  root: webDir,
  resolve: { tsconfigPaths: true },
  clearScreen: false,
  plugins: [
    cloudflare({
      configPath: wranglerConfig,
      viteEnvironment: { name: "ssr" },
      inspectorPort: false,
      persistState: { path: join(resolve(wranglerConfig, ".."), "state") },
    }),
    tanstackStart(),
    tailwindcss(),
    viteReact(),
  ],
};
