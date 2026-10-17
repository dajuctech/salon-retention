// Shared helpers for screen queries.
import { derivePaymentStatus, type PaymentRow } from "@/domain/payment-status";
import { DAY_MS, atLocal, localParts } from "@/domain/time";

export function dayRange(timeZone: string, key: string): { start: Date; end: Date } {
  const [y, m, d] = key.split("-").map(Number);
  const start = atLocal(timeZone, y, m, d);
  const end = atLocal(timeZone, y, m, d + 1);
  return { start, end };
}

export function todayRange(timeZone: string, now = new Date()) {
  const p = localParts(now, timeZone);
  const start = atLocal(timeZone, p.year, p.month, p.day);
  return { start, end: atLocal(timeZone, p.year, p.month, p.day + 1) };
}

/** Monday 00:00 of the current salon-local week. */
export function weekStart(timeZone: string, now = new Date()): Date {
  const p = localParts(now, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const back = (weekday + 6) % 7;
  return atLocal(timeZone, p.year, p.month, p.day - back);
}

export function daysAgo(n: number, now = new Date()): Date {
  return new Date(now.getTime() - n * DAY_MS);
}

type PaymentLike = PaymentRow & { method?: string };

/** Revenue = money actually taken: payments and adjustments minus refunds; free loyalty cuts excluded. */
export function revenueOf(rows: readonly PaymentLike[]): number {
  return rows.reduce((sum, r) => {
    if (r.method === "LOYALTY") return sum;
    if (r.kind === "REFUND") return sum - r.amountMinor;
    return sum + r.amountMinor;
  }, 0);
}

export function paymentState(priceMinor: number, rows: readonly PaymentRow[]) {
  return derivePaymentStatus(priceMinor, rows);
}

/** "5 weeks ago", "2 wks ago", "3 days ago", "today". */
export function relativeAgo(then: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - then.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

/** Barbers never see full phone numbers (docs/permissions.md). */
export function maskPhone(e164: string): string {
  return e164.length > 4 ? `••• ••• ${e164.slice(-4)}` : "••••";
}
