import { describe, expect, it } from "vitest";
import {
  frequencyCapAllows,
  isBirthdayToday,
  isQuietTime,
  messageIdempotencyKey,
  nextAllowedSendTime,
  planAppointmentReminders,
  usualGapDays,
  whyNow,
  winbackDecision,
  type WinbackInput,
} from "./messaging-rules";

const LAGOS = "Africa/Lagos"; // UTC+1, no DST
const LONDON = "Europe/London";

const reminderSettings = {
  timeZone: LAGOS,
  dayBeforeOn: true,
  dayBeforeHour: 18,
  shortOn: true,
  shortHours: 2,
};

describe("BR-R4 appointment reminders", () => {
  it("plans 18:00 the evening before and 2 hours before (salon local time)", () => {
    // Thu 15 Oct 11:30 Lagos = 10:30Z, booked days earlier.
    const plan = planAppointmentReminders(
      new Date("2026-10-15T10:30:00Z"),
      new Date("2026-10-10T09:00:00Z"),
      reminderSettings,
    );
    expect(plan).toEqual([
      { type: "REMINDER_DAY_BEFORE", sendAt: new Date("2026-10-14T17:00:00Z") },
      { type: "REMINDER_2H", sendAt: new Date("2026-10-15T08:30:00Z") },
    ]);
  });

  it("skips the day-before reminder when booked after it would have gone", () => {
    const plan = planAppointmentReminders(
      new Date("2026-10-15T10:30:00Z"),
      new Date("2026-10-14T19:00:00Z"),
      reminderSettings,
    );
    expect(plan.map((p) => p.type)).toEqual(["REMINDER_2H"]);
  });

  it("skips reminders due within 30 minutes of booking", () => {
    const plan = planAppointmentReminders(
      new Date("2026-10-15T10:30:00Z"),
      new Date("2026-10-15T08:15:00Z"),
      reminderSettings,
    );
    expect(plan).toEqual([]);
  });

  it("respects the per-salon toggles", () => {
    const plan = planAppointmentReminders(new Date("2026-10-15T10:30:00Z"), new Date("2026-10-01T00:00:00Z"), {
      ...reminderSettings,
      dayBeforeOn: false,
    });
    expect(plan.map((p) => p.type)).toEqual(["REMINDER_2H"]);
  });

  it("handles the day before a DST change in London", () => {
    // Clocks go back on Sun 25 Oct 2026. Appointment Mon 26 Oct 10:00 GMT.
    const plan = planAppointmentReminders(
      new Date("2026-10-26T10:00:00Z"),
      new Date("2026-10-01T00:00:00Z"),
      { ...reminderSettings, timeZone: LONDON },
    );
    expect(plan[0]).toEqual({ type: "REMINDER_DAY_BEFORE", sendAt: new Date("2026-10-25T18:00:00Z") });
  });
});

describe("BR-R7 quiet hours", () => {
  const q = { timeZone: LAGOS, start: 20, end: 8 };

  it("detects quiet time in salon local time", () => {
    expect(isQuietTime(new Date("2026-10-14T19:30:00Z"), q)).toBe(true); // 20:30 Lagos
    expect(isQuietTime(new Date("2026-10-14T06:59:00Z"), q)).toBe(true); // 07:59 Lagos
    expect(isQuietTime(new Date("2026-10-14T07:00:00Z"), q)).toBe(false); // 08:00 Lagos
  });

  it("moves late-evening sends to 08:00 next day and early sends to 08:00 same day", () => {
    expect(nextAllowedSendTime(new Date("2026-10-14T21:00:00Z"), q)).toEqual(new Date("2026-10-15T07:00:00Z"));
    expect(nextAllowedSendTime(new Date("2026-10-14T03:00:00Z"), q)).toEqual(new Date("2026-10-14T07:00:00Z"));
    const allowed = new Date("2026-10-14T12:00:00Z");
    expect(nextAllowedSendTime(allowed, q)).toBe(allowed);
  });
});

describe("BR-R6 frequency cap", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("allows up to the weekly cap with at most one per day", () => {
    expect(frequencyCapAllows([], now, 2)).toBe(true);
    expect(frequencyCapAllows([new Date("2026-10-10T12:00:00Z")], now, 2)).toBe(true);
    expect(frequencyCapAllows([new Date("2026-10-14T08:00:00Z")], now, 2)).toBe(false);
    expect(frequencyCapAllows([new Date("2026-10-09T12:00:00Z"), new Date("2026-10-11T12:00:00Z")], now, 2)).toBe(
      false,
    );
  });
  it("ignores sends older than 7 days", () => {
    expect(frequencyCapAllows([new Date("2026-10-01T12:00:00Z"), new Date("2026-10-02T12:00:00Z")], now, 2)).toBe(
      true,
    );
  });
});

describe("BR-R8 idempotency key", () => {
  it("uses the salon-local due date", () => {
    // 23:30Z on the 14th is 00:30 on the 15th in Lagos.
    expect(messageIdempotencyKey("s1", "BIRTHDAY", "c1", new Date("2026-10-14T23:30:00Z"), LAGOS)).toBe(
      "s1:BIRTHDAY:c1:2026-10-15",
    );
  });
});

describe("BR-R3a usual gap", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  it("uses the median of recent gaps (design: Segun usually every 3 weeks)", () => {
    expect(usualGapDays([d("2026-07-01"), d("2026-07-22"), d("2026-08-12"), d("2026-09-09")], 21)).toBe(21);
  });
  it("falls back to the service default with fewer than 3 visits", () => {
    expect(usualGapDays([d("2026-09-01"), d("2026-09-08")], 28)).toBe(28);
    expect(usualGapDays([], 28)).toBe(28);
  });
  it("only uses the last 6 gaps", () => {
    const old = ["2026-01-01", "2026-03-01", "2026-05-01"].map(d); // 59–61 day gaps
    const recent = ["2026-05-15", "2026-05-29", "2026-06-12", "2026-06-26", "2026-07-10", "2026-07-24"].map(d);
    expect(usualGapDays([...old, ...recent], 21)).toBe(14);
  });
  it("clamps to 7–90 days and ignores same-day duplicates", () => {
    expect(usualGapDays([d("2026-09-01"), d("2026-09-02"), d("2026-09-03")], 21)).toBe(7);
    expect(usualGapDays([d("2025-01-01"), d("2025-07-01"), d("2026-01-01")], 21)).toBe(90);
    expect(usualGapDays([d("2026-09-01"), d("2026-09-01"), d("2026-09-15")], 21)).toBe(21);
  });
});

describe("BR-R3b win-back eligibility", () => {
  const base: WinbackInput = {
    now: new Date("2026-10-14T12:00:00Z"),
    lastVisitAt: new Date("2026-09-09T12:00:00Z"), // 35 days ago
    usualGapDays: 21,
    graceDays: 7,
    cooldownDays: 21,
    lastWinbackAt: null,
    hasUpcomingBooking: false,
    marketingConsent: true,
    holdout: false,
  };

  it("is due when past usual gap + grace", () => {
    expect(winbackDecision(base)).toEqual({ due: true });
  });
  it.each([
    [{ lastVisitAt: null }, "no_visits"],
    [{ lastVisitAt: new Date("2026-09-20T12:00:00Z") }, "not_yet"],
    [{ hasUpcomingBooking: true }, "upcoming_booking"],
    [{ marketingConsent: false }, "no_consent"],
    [{ lastWinbackAt: new Date("2026-10-01T12:00:00Z") }, "cooldown"],
    [{ holdout: true }, "holdout"],
  ] as const)("is suppressed: %o → %s", (patch, reason) => {
    expect(winbackDecision({ ...base, ...patch })).toEqual({ due: false, reason });
  });

  it("writes the Why now line from data, not AI", () => {
    expect(whyNow(base.now, base.lastVisitAt!, 21, "Tunde")).toBe(
      "Last visit 5 weeks ago. Usually every 3 weeks with Tunde.",
    );
    expect(whyNow(base.now, new Date("2026-10-04T12:00:00Z"), 10)).toBe("Last visit 10 days ago. Usually every 10 days.");
  });
});

describe("BR-R5 birthdays", () => {
  it("matches on the salon-local date", () => {
    // 23:30Z on 21 Nov is already 22 Nov in Lagos.
    expect(isBirthdayToday(11, 22, new Date("2026-11-21T23:30:00Z"), LAGOS)).toBe(true);
    expect(isBirthdayToday(11, 22, new Date("2026-11-21T22:30:00Z"), LAGOS)).toBe(false);
  });
  it("celebrates 29 Feb on 28 Feb in non-leap years only", () => {
    expect(isBirthdayToday(2, 29, new Date("2027-02-28T12:00:00Z"), LAGOS)).toBe(true);
    expect(isBirthdayToday(2, 29, new Date("2028-02-28T12:00:00Z"), LAGOS)).toBe(false);
    expect(isBirthdayToday(2, 29, new Date("2028-02-29T12:00:00Z"), LAGOS)).toBe(true);
  });
});
