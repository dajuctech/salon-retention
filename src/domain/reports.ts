// Report maths (docs/metrics.md). Pure functions over plain data so they're easy to test.
import { DAY_MS } from "./time";

export const RETURN_WINDOW_DAYS = 42; // "Customers who returned within 6 weeks"

export type Visit = { customerId: string; at: Date };

/**
 * 6-week return rate for the period ending `end`. The cohort is visits that happened in the
 * `periodDays` before `end − 42 days`, so every visit has had a full 42 days to be followed up.
 * Returns null when the cohort is empty (not enough history yet).
 */
export function returnRate(
  completedVisits: readonly Visit[],
  end: Date,
  periodDays: number,
): { rate: number; cohort: number; returned: number } | null {
  const cohortEnd = end.getTime() - RETURN_WINDOW_DAYS * DAY_MS;
  const cohortStart = cohortEnd - periodDays * DAY_MS;
  const byCustomer = new Map<string, number[]>();
  for (const v of completedVisits) {
    const list = byCustomer.get(v.customerId) ?? [];
    list.push(v.at.getTime());
    byCustomer.set(v.customerId, list);
  }
  let cohort = 0;
  let returned = 0;
  for (const times of byCustomer.values()) {
    times.sort((a, b) => a - b);
    times.forEach((t, i) => {
      if (t < cohortStart || t >= cohortEnd) return;
      cohort++;
      const next = times[i + 1];
      if (next !== undefined && next - t <= RETURN_WINDOW_DAYS * DAY_MS) returned++;
    });
  }
  return cohort === 0 ? null : { rate: returned / cohort, cohort, returned };
}

/** Percentage change, or null when there's nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export type SentMessage = { customerId: string; sentAt: Date };
export type BookingMade = { customerId: string; createdAt: Date; revenueMinor: number };

/**
 * "Booked within 7 days of a message": bookings created within `windowDays` after a marketing
 * message to the same customer. Each booking is counted once. This is correlation, not proof
 * that the message caused the booking (that needs the holdout comparison).
 */
export function bookedAfterMessage(
  messages: readonly SentMessage[],
  bookings: readonly BookingMade[],
  windowDays = 7,
): { bookings: number; revenueMinor: number } {
  const byCustomer = new Map<string, number[]>();
  for (const m of messages) {
    const list = byCustomer.get(m.customerId) ?? [];
    list.push(m.sentAt.getTime());
    byCustomer.set(m.customerId, list);
  }
  let count = 0;
  let revenue = 0;
  for (const b of bookings) {
    const t = b.createdAt.getTime();
    const hit = byCustomer.get(b.customerId)?.some((s) => t >= s && t - s <= windowDays * DAY_MS);
    if (hit) {
      count++;
      revenue += b.revenueMinor;
    }
  }
  return { bookings: count, revenueMinor: revenue };
}

/** Splits [start, end) into consecutive 7-day buckets (the last may be partial: "So far"). */
export function weekBuckets(start: Date, end: Date): { start: Date; end: Date; partial: boolean }[] {
  const out = [];
  for (let t = start.getTime(); t < end.getTime(); t += 7 * DAY_MS) {
    const e = Math.min(t + 7 * DAY_MS, end.getTime());
    out.push({ start: new Date(t), end: new Date(e), partial: e - t < 7 * DAY_MS });
  }
  return out;
}
