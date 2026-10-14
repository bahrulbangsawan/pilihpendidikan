// Dates and numbers in the UI locale. Timestamps are epoch ms (PLAN C2).

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import { intlLocale } from "@/i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", YEAR],
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

/** "3 days ago", "in 2 hours", "now". */
export function relativeTime(
  ms: number,
  nowMs: number,
  locale: Locale
): string {
  const delta = ms - nowMs;
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
    style: "long",
  });
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) {
      return format.format(Math.round(delta / size), unit);
    }
  }
  return format.format(0, "minute");
}

/** "3d", "2h", "5m": the compact age on cards. */
export function compactAge(ms: number, nowMs: number): string {
  const age = Math.max(0, nowMs - ms);
  if (age >= DAY) {
    return `${Math.floor(age / DAY)}d`;
  }
  if (age >= HOUR) {
    return `${Math.floor(age / HOUR)}h`;
  }
  return `${Math.max(1, Math.floor(age / MINUTE))}m`;
}

export function formatDate(
  ms: number,
  locale: Locale,
  timeZone?: string | null
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(ms);
}

export function formatDateTime(
  ms: number,
  locale: Locale,
  timeZone?: string | null
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(ms);
}

/** "14:02". */
export function formatClock(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

/** A run duration: "850 ms", "4.5 s", "2 min 5 s", "1 h 3 min". */
export function formatDuration(ms: number, locale: Locale): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) {
    return `${formatNumber(value, locale)} ms`;
  }
  if (value < MINUTE) {
    const seconds = new Intl.NumberFormat(intlLocale(locale), {
      maximumFractionDigits: 1,
    }).format(value / 1000);
    return `${seconds} s`;
  }
  if (value < HOUR) {
    const minutes = Math.floor(value / MINUTE);
    const seconds = Math.round((value % MINUTE) / 1000);
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  const hours = Math.floor(value / HOUR);
  const minutes = Math.round((value % HOUR) / MINUTE);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMoney(
  amount: number,
  currency: string | undefined,
  locale: Locale
): string {
  if (!currency) {
    return formatNumber(amount, locale);
  }
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${formatNumber(amount, locale)}`;
  }
}

/** `<input type="datetime-local">` value for ms, in the browser's zone. */
export function toDateTimeLocalValue(ms: number | null): string {
  if (ms === null) {
    return "";
  }
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `<input type="date">` value for ms, in the browser's zone. */
export function toDateValue(ms: number | null): string {
  return toDateTimeLocalValue(ms).slice(0, 10);
}

/** Epoch ms of a `datetime-local` / `date` input value, or null. */
export function fromLocalInputValue(value: string): number | null {
  if (!value) {
    return null;
  }
  const ms = new Date(value.length === 10 ? `${value}T09:00` : value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The browser's IANA timezone. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
