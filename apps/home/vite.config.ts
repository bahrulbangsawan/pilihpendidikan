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
    ...(!isVitest
      ? [cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false })]
      : []),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
