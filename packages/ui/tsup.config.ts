import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.tsx", "src/**/*.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  external: [
    "react",
    "react-dom",
    "@base-ui/react",
    "@dnd-kit/core",
    "@dnd-kit/sortable",
    "@dnd-kit/utilities",
    "class-variance-authority",
    "clsx",
    "lucide-react",
    "radix-ui",
    "react-phone-number-input",
    "react-day-picker",
    "tailwind-merge",
    "zustand",
  ],
  treeshake: true,
  sourcemap: false,
  clean: true,
});
