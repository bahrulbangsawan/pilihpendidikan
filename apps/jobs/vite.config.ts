import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const isVitest = Boolean(process.env.VITEST);

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    ...(isVitest
      ? []
      : [
          cloudflare({
            viteEnvironment: { name: "ssr" },
            inspectorPort: false,
          }),
          tanstackStart(),
        ]),
    tailwindcss(),
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
              name: "vendor-query",
              test: (id) => id.includes("@tanstack/react-query"),
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
