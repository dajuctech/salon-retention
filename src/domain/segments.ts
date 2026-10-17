// Customer segments and list badges (docs/business-rules.md §6). Deterministic, not AI.
import { DAY_MS, isLeapYear, localParts } from "./time";

export type CustomerFacts = {
  visitCount: number;
  lastVisitAt: Date | null;
  firstVisitAt: Date | null;
  usualGapDays: number | null;
  fallbackGapDays: number;
  birthMonth: number | null;
  birthDay: number | null;
  hasUpcomingBooking: boolean;
  noShowsLast90Days: number;
  cancellationsLast90Days: number;
  completedLast180Days: number;
};

export type Segment = "due" | "birthday" | "new" | "loyal" | "inactive" | "frequent_canceller";

/** Days from salon-local today until the next birthday (0 = today). */
export function daysUntilBirthday(month: number, day: number, now: Date, timeZone: string): number {
  const t = localParts(now, timeZone);
  const today = Date.UTC(t.year, t.month - 1, t.day);
  for (const year of [t.year, t.year + 1]) {
    const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
    const candidate = Date.UTC(year, month - 1, d);
    if (candidate >= today) return Math.round((candidate - today) / DAY_MS);
  }
  return 365;
}

export function isDueToReturn(f: CustomerFacts, now: Date): boolean {
  if (!f.lastVisitAt || f.hasUpcomingBooking) return false;
  const gap = f.usualGapDays ?? f.fallbackGapDays;
  return now.getTime() >= f.lastVisitAt.getTime() + gap * DAY_MS;
}

export function segmentsFor(f: CustomerFacts, now: Date, timeZone: string): Segment[] {
  const out: Segment[] = [];
  if (isDueToReturn(f, now)) out.push("due");
  if (f.birthMonth && f.birthDay && daysUntilBirthday(f.birthMonth, f.birthDay, now, timeZone) <= 6) out.push("birthday");
  if (f.firstVisitAt && f.visitCount <= 1 && now.getTime() - f.firstVisitAt.getTime() <= 30 * DAY_MS) out.push("new");
  if (f.completedLast180Days >= 5) out.push("loyal");
  if (f.lastVisitAt && f.visitCount >= 1 && now.getTime() - f.lastVisitAt.getTime() > 45 * DAY_MS) out.push("inactive");
  if (f.noShowsLast90Days + f.cancellationsLast90Days >= 2) out.push("frequent_canceller");
  return out;
}

export type Badge = { label: "Due" | "Birthday" | "New" | "No-show" | "Regular"; tone: BadgeTone };
export type BadgeTone = "amber" | "green" | "blue" | "red" | "grey";

/** One badge per list row, in the design's priority order (p6). */
export function primaryBadge(segments: Segment[], today: { noShow: boolean }): Badge {
  if (today.noShow) return { label: "No-show", tone: "red" };
  if (segments.includes("birthday")) return { label: "Birthday", tone: "green" };
  if (segments.includes("due")) return { label: "Due", tone: "amber" };
  if (segments.includes("new")) return { label: "New", tone: "blue" };
  return { label: "Regular", tone: "grey" };
}
