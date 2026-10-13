import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tests run without the Cloudflare and TanStack Start plugins: they cover the
// pure modules (src/lib), the hooks and components in happy-dom, and the
// BFF core with an injected fetch. Nothing imports `cloudflare:workers`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [viteReact()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // The stats page renders charts in happy-dom; under the parallel turbo
    // test fan-out the default 5 s is too tight.
    testTimeout: 30_000,
  },
});
