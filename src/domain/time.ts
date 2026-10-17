// Salon-local time helpers (BR-T1, BR-T2). All inputs and outputs are UTC instants;
// calendar logic runs in the salon's IANA timezone.
import { TZDate } from "@date-fns/tz";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

/** month is 1–12. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const d = new TZDate(instant.getTime(), timeZone);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

/** The UTC instant of a salon-local wall-clock time. month is 1–12; overflowing days roll over. */
export function atLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(new TZDate(year, month - 1, day, hour, minute, 0, timeZone).getTime());
}

/** YYYY-MM-DD in the salon's timezone. */
export function localDateKey(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
