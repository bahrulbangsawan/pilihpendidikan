import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
const isVitest = Boolean(process.env.VITEST);

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Vitest stubs CSS imports with empty strings; the deck-palette test
    // reads the deck's `.pf-*` stylesheet as text, so let that one through.
    css: { include: [/src\/styles\.css/] },
  },
  plugins: [
    ...(!isVitest
      ? [cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false })]
      : []),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-router",
              test: (id) =>
                id.includes("@tanstack/react-router") ||
                id.includes("@tanstack/react-start"),
            },
            {
              name: "vendor-dnd",
              test: (id) => id.includes("@dnd-kit/"),
            },
            {
              name: "vendor-icons",
              test: (id) => id.includes("lucide-react"),
            },
          ],
        },
      },
    },
  },
});

export default config;
