import { describe, expect, it } from "vitest";
import { bookedAfterMessage, pctChange, returnRate, weekBuckets } from "./reports";
import { daysUntilBirthday, isDueToReturn, primaryBadge, segmentsFor, type CustomerFacts } from "./segments";

const TZ = "Africa/Lagos";
const now = new Date("2026-10-14T12:00:00Z");
const d = (s: string) => new Date(`${s}T12:00:00Z`);

const base: CustomerFacts = {
  visitCount: 11,
  lastVisitAt: d("2026-09-09"),
  firstVisitAt: d("2025-06-01"),
  usualGapDays: 21,
  fallbackGapDays: 21,
  birthMonth: 11,
  birthDay: 22,
  hasUpcomingBooking: false,
  noShowsLast90Days: 0,
  cancellationsLast90Days: 0,
  completedLast180Days: 6,
};

describe("segments (business-rules §6)", () => {
  it("design p6: Segun is due (5 weeks, usually 3) and loyal", () => {
    expect(segmentsFor(base, now, TZ)).toEqual(["due", "loyal"]);
  });

  it("is not due with an upcoming booking, or before the usual gap", () => {
    expect(isDueToReturn({ ...base, hasUpcomingBooking: true }, now)).toBe(false);
    expect(isDueToReturn({ ...base, lastVisitAt: d("2026-10-01") }, now)).toBe(false);
    expect(isDueToReturn({ ...base, usualGapDays: null, fallbackGapDays: 60 }, now)).toBe(false);
  });

  it("flags birthdays within the coming week in salon time, across year end and 29 Feb", () => {
    expect(daysUntilBirthday(10, 14, now, TZ)).toBe(0);
    expect(daysUntilBirthday(10, 17, now, TZ)).toBe(3);
    expect(daysUntilBirthday(10, 13, now, TZ)).toBe(364);
    expect(daysUntilBirthday(1, 2, new Date("2026-12-30T12:00:00Z"), TZ)).toBe(3);
    expect(daysUntilBirthday(2, 29, new Date("2027-02-27T12:00:00Z"), TZ)).toBe(1); // 28 Feb in 2027
    expect(segmentsFor({ ...base, birthMonth: 10, birthDay: 17 }, now, TZ)).toContain("birthday");
  });

  it("marks new, inactive and frequent cancellers", () => {
    expect(segmentsFor({ ...base, visitCount: 1, firstVisitAt: d("2026-10-10"), lastVisitAt: d("2026-10-10") }, now, TZ)).toContain(
      "new",
    );
    expect(segmentsFor({ ...base, lastVisitAt: d("2026-08-01") }, now, TZ)).toContain("inactive");
    expect(segmentsFor({ ...base, noShowsLast90Days: 1, cancellationsLast90Days: 1 }, now, TZ)).toContain(
      "frequent_canceller",
    );
  });

  it("picks one badge in the design's priority order", () => {
    expect(primaryBadge(["due", "birthday"], { noShow: false })).toEqual({ label: "Birthday", tone: "green" });
    expect(primaryBadge(["due"], { noShow: true })).toEqual({ label: "No-show", tone: "red" });
    expect(primaryBadge(["new"], { noShow: false }).label).toBe("New");
    expect(primaryBadge([], { noShow: false }).label).toBe("Regular");
  });
});

describe("6-week return rate (metrics.md)", () => {
  const end = d("2026-10-14");
  it("only counts visits that have had a full 42 days to be followed up", () => {
    const visits = [
      { customerId: "a", at: d("2026-08-01") },
      { customerId: "a", at: d("2026-08-20") }, // returned within 42 days of 1 Aug
      { customerId: "b", at: d("2026-08-02") }, // never returned
      { customerId: "c", at: d("2026-10-01") }, // too recent to judge: excluded
    ];
    // cohort = the 60 days before (14 Oct − 42 days = 2 Sep), i.e. 3 Jul .. 2 Sep
    expect(returnRate(visits, end, 60)).toEqual({ rate: 1 / 3, cohort: 3, returned: 1 });
  });

  it("returns null with no history rather than a misleading 0%", () => {
    expect(returnRate([{ customerId: "c", at: d("2026-10-01") }], end, 30)).toBeNull();
  });
});

describe("pctChange", () => {
  it("handles growth, decline and no baseline", () => {
    expect(pctChange(108, 100)).toBeCloseTo(8);
    expect(pctChange(90, 100)).toBeCloseTo(-10);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("Booked within 7 days of a message", () => {
  it("counts each booking once, only after a message to the same customer", () => {
    const messages = [
      { customerId: "a", sentAt: d("2026-10-01") },
      { customerId: "a", sentAt: d("2026-10-03") },
      { customerId: "b", sentAt: d("2026-10-01") },
    ];
    const bookings = [
      { customerId: "a", createdAt: d("2026-10-04"), revenueMinor: 300_000 }, // after 2 messages: once
      { customerId: "b", createdAt: d("2026-10-09"), revenueMinor: 450_000 }, // 8 days: too late
      { customerId: "c", createdAt: d("2026-10-02"), revenueMinor: 200_000 }, // never messaged
      { customerId: "b", createdAt: d("2026-09-30"), revenueMinor: 200_000 }, // before the message
    ];
    expect(bookedAfterMessage(messages, bookings)).toEqual({ bookings: 1, revenueMinor: 300_000 });
  });
});

describe("weekBuckets", () => {
  it("splits a 30-day period into four full weeks and a partial 'so far'", () => {
    const buckets = weekBuckets(d("2026-09-14"), d("2026-10-14"));
    expect(buckets).toHaveLength(5);
    expect(buckets.map((b) => b.partial)).toEqual([false, false, false, false, true]);
  });
});
