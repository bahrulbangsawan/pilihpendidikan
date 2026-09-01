import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import viteTsConfigPaths from "vite-tsconfig-paths"
const isVitest = Boolean(process.env.VITEST)

const config = defineConfig({
  plugins: [
    ...(!isVitest
      ? [cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false })]
      : []),
    devtools(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("@tanstack/react-router") ||
            id.includes("@tanstack/react-start")
          ) {
            return "vendor-router";
          }
          if (id.includes("@dnd-kit/")) {
            return "vendor-dnd";
          }
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
        },
      },
    },
  },
})

export default config

