// ISO calendar-date helpers for the date pickers (`ui/date-picker.tsx`).
// Dates travel as local `YYYY-MM-DD` strings (and `YYYY-MM-DDTHH:mm` with a
// time) so they serialise as-is and never shift with the time zone. No
// date-fns: the pickers only need these few operations.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `Date` → local `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `Date` → local `YYYY-MM-DDTHH:mm`. */
export function toIsoDateTime(date: Date): string {
  return `${toIsoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Local `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm`) → `Date` at local midnight (or
 * that local time). `undefined` for an empty or malformed string.
 */
export function parseIsoDate(
  value: string | null | undefined
): Date | undefined {
  if (!value) {
    return;
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    return;
  }
  const [, y, m, d, hh, mm] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    hh ? Number(hh) : 0,
    mm ? Number(mm) : 0
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Today as `YYYY-MM-DD`. */
export function isoToday(): string {
  return toIsoDate(new Date());
}

/** `iso` plus `days` (negative to go back), as `YYYY-MM-DD`. */
export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso) ?? new Date();
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** The first day of `iso`'s month, offset by `months`. */
export function startOfMonthIso(iso: string, months = 0): string {
  const date = parseIsoDate(iso) ?? new Date();
  return toIsoDate(new Date(date.getFullYear(), date.getMonth() + months, 1));
}

/** The last day of `iso`'s month, offset by `months`. */
export function endOfMonthIso(iso: string, months = 0): string {
  const date = parseIsoDate(iso) ?? new Date();
  return toIsoDate(
    new Date(date.getFullYear(), date.getMonth() + months + 1, 0)
  );
}

/** Formats an ISO date (or date-time) for display, e.g. "24 Nov 2026". */
export function formatIsoDate(
  value: string,
  locale?: string,
  withTime = false
): string {
  const date = parseIsoDate(value);
  if (!date) {
    return value;
  }
  return date.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
