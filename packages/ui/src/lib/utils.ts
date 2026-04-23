import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhoneDisplay(phone: string): string {
  if (!phone) {
    return phone;
  }

  const hasPlus = phone.startsWith("+");
  const digits = phone.replace(/\D/g, "");

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
  if (groups.length > 1 && groups[0]!.length === 1) {
    groups[0] = groups[0]! + groups[1]!;
    groups.splice(1, 1);
  }

  return (hasPlus ? "+" : "") + groups.join("-");
}

export function ensureUrl(url: string): string {
  if (!url) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `https://${url}`;
}
