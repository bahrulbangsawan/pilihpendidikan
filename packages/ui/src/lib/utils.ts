import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const NON_DIGIT_RE = /\D/g;
const HTTP_PROTOCOL_RE = /^https?:\/\//i;

// tailwind-merge has no knowledge of the custom Warp typography utilities the
// apps define in `@theme inline { … }` (see DESIGN.md / TYPOGRAPHY.md). Without
// this config it reads `text-body-sm` as a text colour, so
// `cn("text-body-sm", "text-muted-foreground")` silently drops the size and the
// element renders at the inherited size. Register the custom font-size names so
// cn() preserves them. The Warp scale bakes letter-spacing into each size token
// (`--text-*--letter-spacing`), so there are no tracking utilities to register.
// `bun run parity:twmerge` keeps this list in sync with every app's @theme.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "heading-lg",
            "heading",
            "heading-sm",
            "subheading",
            "body",
            "body-sm",
            "caption-tracked",
            "micro",
          ],
        },
      ],
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
