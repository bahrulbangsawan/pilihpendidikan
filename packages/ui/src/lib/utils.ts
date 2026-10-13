import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { TYPE_UTILITIES, TYPE_WEIGHTS } from "./type-scale";

// The display formats the CV templates share with the other builders live
// in the CV engine, which the api Worker and the PDF templates use without
// this library; existing `@rulisme/ui/lib/utils` imports keep working.
// biome-ignore lint/performance/noBarrelFile: one re-export, kept for the apps' existing imports
export {
  ensureUrl,
  formatPhoneDisplay,
} from "@pilihpendidikan/cv-engine/format";

// tailwind-merge knows nothing about the Zedative type utilities defined in
// `@rulisme/ui/styles/theme.css` (DESIGN.md / TYPOGRAPHY.md). Register the
// roles (`type-body`, `type-title-compact`, …) and the weights
// (`weight-semibold`, …) as their own groups so `cn()` keeps the last role
// and the last weight, and drops any generic size, leading or weight they
// replace. `bun run parity:twmerge` keeps these lists in sync with theme.css.
const twMerge = extendTailwindMerge<"type-role" | "type-weight">({
  extend: {
    classGroups: {
      "type-role": [{ type: TYPE_UTILITIES }],
      "type-weight": [{ weight: [...TYPE_WEIGHTS] }],
    },
    conflictingClassGroups: {
      "type-role": ["font-size", "leading"],
      "type-weight": ["font-weight"],
      "font-weight": ["type-weight"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
