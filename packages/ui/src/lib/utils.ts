import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { TYPE_UTILITIES, TYPE_WEIGHTS } from "./type-scale";

const NON_DIGIT_RE = /\D/g;
const HTTP_PROTOCOL_RE = /^https?:\/\//i;

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

export function formatPhoneDisplay(phone: string): string {
  if (!phone) {
    return phone;
  }

  const hasPlus = phone.startsWith("+");
  const digits = phone.replace(NON_DIGIT_RE, "");

  if (digits.length <= 4) {
    return (hasPlus ? "+" : "") + digits;
  }

  const groups: string[] = [];
  let i = digits.length;

  while (i > 0) {
    const start = Math.max(0, i - 4);
    groups.unshift(digits.slice(start, i));
    i = start;
  }

  // Merge a lone leading digit into the next group
  const first = groups[0];
  const second = groups[1];
  if (groups.length > 1 && first && second && first.length === 1) {
    groups[0] = first + second;
    groups.splice(1, 1);
  }

  return (hasPlus ? "+" : "") + groups.join("-");
}

export function ensureUrl(url: string): string {
  if (!url) {
    return url;
  }
  if (HTTP_PROTOCOL_RE.test(url)) {
    return url;
  }
  return `https://${url}`;
}
