import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appSource = fileURLToPath(new URL("./src/", import.meta.url));
const uiSource = fileURLToPath(
  new URL("../../packages/ui/src/", import.meta.url)
);

// The design system page renders `@rulisme/ui` from source, not from its
// built `dist/`, so a component edit hot-reloads here without a library
// rebuild. Every other app keeps consuming the built package.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${appSource}$1` },
      { find: /^@rulisme\/ui\/(.*)$/, replacement: `${uiSource}$1` },
    ],
    dedupe: ["react", "react-dom"],
  },
  // Pre-bundle everything the components import up front. Discovering these
  // lazily makes Vite re-optimise mid-session and serve a second React copy
  // ("Cannot read properties of null (reading 'useContext')").
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "radix-ui",
      "@base-ui/react",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@shadcn/react/message-scroller",
      "@shadcn/react/questionnaire",
      "class-variance-authority",
      "clsx",
      "cmdk",
      "embla-carousel-react",
      "input-otp",
      "lucide-react",
      "next-themes",
      "react-day-picker",
      "react-phone-number-input",
      "react-phone-number-input/flags",
      "react-resizable-panels",
      "recharts",
      "sonner",
      "tailwind-merge",
      "vaul",
    ],
  },
});
