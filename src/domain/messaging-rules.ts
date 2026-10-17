// Messaging rules (docs/business-rules.md §5). Pure functions: callers pass `now`.
import { DAY_MS, HOUR_MS, MINUTE_MS, atLocal, isLeapYear, localDateKey, localParts } from "./time";

// ───────── BR-R4 appointment reminders ─────────

export type ReminderSettings = {
  timeZone: string;
  dayBeforeOn: boolean;
  dayBeforeHour: number; // default 18
  shortOn: boolean;
  shortHours: number; // default 2
};

export type PlannedReminder = { type: "REMINDER_DAY_BEFORE" | "REMINDER_2H"; sendAt: Date };

const MIN_LEAD_MS = 30 * MINUTE_MS;

export function planAppointmentReminders(
  startsAt: Date,
  bookedAt: Date,
  s: ReminderSettings,
): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const earliest = bookedAt.getTime() + MIN_LEAD_MS;

  if (s.dayBeforeOn) {
    const p = localParts(startsAt, s.timeZone);
    const sendAt = atLocal(s.timeZone, p.year, p.month, p.day - 1, s.dayBeforeHour);
    if (sendAt.getTime() >= earliest && sendAt < startsAt) {
      planned.push({ type: "REMINDER_DAY_BEFORE", sendAt });
    }
  }
  if (s.shortOn) {
    const sendAt = new Date(startsAt.getTime() - s.shortHours * HOUR_MS);
    if (sendAt.getTime() >= earliest) planned.push({ type: "REMINDER_2H", sendAt });
  }
  return planned;
}

// ───────── BR-R7 quiet hours (marketing only) ─────────

export type QuietHours = { timeZone: string; start: number; end: number }; // e.g. 20 → 8

export function isQuietTime(instant: Date, q: QuietHours): boolean {
  const { hour } = localParts(instant, q.timeZone);
  return q.start > q.end ? hour >= q.start || hour < q.end : hour >= q.start && hour < q.end;
}

/** Moves a marketing send out of quiet hours to the next allowed local time. */
export function nextAllowedSendTime(instant: Date, q: QuietHours): Date {
  if (!isQuietTime(instant, q)) return instant;
  const p = localParts(instant, q.timeZone);
  const sameDay = p.hour < q.end;
  return atLocal(q.timeZone, p.year, p.month, sameDay ? p.day : p.day + 1, q.end);
}

// ───────── BR-R6 frequency cap ─────────

export function frequencyCapAllows(
  marketingSentAt: readonly Date[],
  now: Date,
  capPerWeek: number,
): boolean {
  const t = now.getTime();
  const lastWeek = marketingSentAt.filter((d) => t - d.getTime() < 7 * DAY_MS);
  const lastDay = lastWeek.filter((d) => t - d.getTime() < DAY_MS);
  return lastWeek.length < capPerWeek && lastDay.length === 0;
}

// ───────── BR-R8 idempotency ─────────

export function messageIdempotencyKey(
  salonId: string,
  type: string,
  subjectId: string,
  dueAt: Date,
  timeZone: string,
): string {
  return `${salonId}:${type}:${subjectId}:${localDateKey(dueAt, timeZone)}`;
}

// ───────── BR-R3a usual gap ─────────

export const USUAL_GAP_MIN_DAYS = 7;
export const USUAL_GAP_MAX_DAYS = 90;

/** Median of the last 6 gaps between completed visits; fallback when < 2 gaps. */
export function usualGapDays(completedVisits: readonly Date[], fallbackDays: number): number {
  const days = [...new Set(completedVisits.map((d) => Math.floor(d.getTime() / DAY_MS)))].sort(
    (a, b) => a - b,
  );
  const gaps = days.slice(1).map((d, i) => d - days[i]).slice(-6);
  const raw = gaps.length >= 2 ? median(gaps) : fallbackDays;
  return Math.min(Math.max(Math.round(raw), USUAL_GAP_MIN_DAYS), USUAL_GAP_MAX_DAYS);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ───────── BR-R3b win-back eligibility ─────────

export type WinbackInput = {
  now: Date;
  lastVisitAt: Date | null;
  usualGapDays: number;
  graceDays: number;
  cooldownDays: number;
  lastWinbackAt: Date | null;
  hasUpcomingBooking: boolean;
  marketingConsent: boolean;
  holdout: boolean;
};

export type WinbackDecision =
  | { due: true }
  | {
      due: false;
      reason: "no_visits" | "not_yet" | "upcoming_booking" | "no_consent" | "cooldown" | "holdout";
    };

export function winbackDecision(i: WinbackInput): WinbackDecision {
  if (!i.lastVisitAt) return { due: false, reason: "no_visits" };
  const dueAt = i.lastVisitAt.getTime() + (i.usualGapDays + i.graceDays) * DAY_MS;
  if (i.now.getTime() < dueAt) return { due: false, reason: "not_yet" };
  if (i.hasUpcomingBooking) return { due: false, reason: "upcoming_booking" };
  if (!i.marketingConsent) return { due: false, reason: "no_consent" };
  if (i.lastWinbackAt && i.now.getTime() - i.lastWinbackAt.getTime() < i.cooldownDays * DAY_MS) {
    return { due: false, reason: "cooldown" };
  }
  if (i.holdout) return { due: false, reason: "holdout" };
  return { due: true };
}

/** Code-generated "Why now" line for the approval queue (ai-design.md §2). */
export function whyNow(now: Date, lastVisitAt: Date, usualGap: number, barberName?: string): string {
  const since = Math.floor((now.getTime() - lastVisitAt.getTime()) / DAY_MS);
  const ago = since >= 14 ? `${Math.round(since / 7)} weeks ago` : `${since} days ago`;
  const every = usualGap >= 14 ? `every ${Math.round(usualGap / 7)} weeks` : `every ${usualGap} days`;
  return `Last visit ${ago}. Usually ${every}${barberName ? ` with ${barberName}` : ""}.`;
}

// ───────── BR-R5 birthdays ─────────

/** True if the customer's birthday falls on the salon-local date of `now`. */
export function isBirthdayToday(
  birthMonth: number,
  birthDay: number,
  now: Date,
  timeZone: string,
): boolean {
  const { year, month, day } = localParts(now, timeZone);
  if (birthMonth === month && birthDay === day) return true;
  // 29 Feb birthdays are celebrated on 28 Feb in non-leap years.
  return birthMonth === 2 && birthDay === 29 && !isLeapYear(year) && month === 2 && day === 28;
}

// ───────── BR-R9 retries ─────────

export const MAX_SEND_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1, 5, 30, 120].map((m) => m * MINUTE_MS);

/** Delay before the next attempt, or null when the message should be marked FAILED. */
export function retryDelayMs(attemptsSoFar: number): number | null {
  return attemptsSoFar >= MAX_SEND_ATTEMPTS ? null : RETRY_DELAYS_MS[attemptsSoFar - 1] ?? null;
}

// ───────── BR-PR3 cost estimate ─────────

/**
 * Illustrative per-message prices in USD. NOT Meta's rate card: replace with the current
 * published prices for each country before launch (docs/whatsapp-templates.md).
 */
export const ESTIMATED_PRICE_USD: Record<string, { marketing: number; utility: number }> = {
  NG: { marketing: 0.05, utility: 0.01 },
  GB: { marketing: 0.06, utility: 0.02 },
  default: { marketing: 0.06, utility: 0.02 },
};

export function estimateCostUsd(count: number, category: "marketing" | "utility", countryCode: string): number {
  const price = ESTIMATED_PRICE_USD[countryCode] ?? ESTIMATED_PRICE_USD.default;
  return Math.round(count * price[category] * 100) / 100;
}
