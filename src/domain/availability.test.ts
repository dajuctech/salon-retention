import { describe, expect, it } from "vitest";
import { availableSlots, intersectRanges, mergeGrids, pickAnyBarber, slotGrid, type SlotQuery } from "./availability";

const h = (hh: number, mm = 0) => hh * 60 + mm;

// Thu 15 Oct 2026, Lagos (UTC+1). Salon 09:00–19:00, Tunde 09:00–18:00.
const base: SlotQuery = {
  timeZone: "Africa/Lagos",
  date: { year: 2026, month: 10, day: 15 },
  closed: false,
  salonHours: [{ startMin: h(9), endMin: h(19) }],
  barberHours: [{ startMin: h(9), endMin: h(18) }],
  busy: [],
  durationMin: 30,
  bufferMin: 0,
  gridMin: 30,
  now: new Date("2026-10-14T08:00:00Z"),
  minLeadMin: 60,
  maxAdvanceDays: 30,
};

const lagos = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 15, hh - 1, mm));

describe("BR-A1 slot availability", () => {
  it("offers slots inside both salon and barber hours", () => {
    const slots = availableSlots(base);
    expect(slots[0]).toEqual(lagos(9));
    expect(slots.at(-1)).toEqual(lagos(17, 30)); // last 30-min cut must finish by 18:00
    expect(slots).toHaveLength(18);
  });

  it("removes slots that overlap a booking, including its buffer", () => {
    const slots = availableSlots({
      ...base,
      busy: [{ start: lagos(11), end: lagos(11, 30) }], // design: 11:00 taken
      bufferMin: 10,
    });
    expect(slots).not.toContainEqual(lagos(11));
    expect(slots).not.toContainEqual(lagos(10, 30)); // 10:30 + 30 + 10 buffer runs into 11:00
    expect(slots).toContainEqual(lagos(11, 30));
  });

  it("returns nothing on a closed date", () => {
    expect(availableSlots({ ...base, closed: true })).toEqual([]);
  });

  it("respects lunch breaks (multiple ranges)", () => {
    const slots = availableSlots({
      ...base,
      barberHours: [
        { startMin: h(9), endMin: h(13) },
        { startMin: h(14), endMin: h(18) },
      ],
    });
    expect(slots).not.toContainEqual(lagos(13));
    expect(slots).not.toContainEqual(lagos(13, 30));
    expect(slots).toContainEqual(lagos(14));
  });
});

describe("slotGrid and mergeGrids (taken slots shown struck through)", () => {
  it("marks taken slots instead of dropping them", () => {
    const grid = slotGrid({ ...base, busy: [{ start: lagos(11), end: lagos(11, 30) }] });
    expect(grid.find((s) => s.start.getTime() === lagos(11).getTime())).toEqual({ start: lagos(11), available: false });
    expect(grid.filter((s) => s.available)).toHaveLength(17);
  });

  it("treats a time as free for 'Any barber' if at least one barber is free", () => {
    const tunde = [
      { start: lagos(10), available: false },
      { start: lagos(10, 30), available: true },
    ];
    const chidi = [
      { start: lagos(10), available: true },
      { start: lagos(11), available: false },
    ];
    expect(mergeGrids([tunde, chidi])).toEqual([
      { start: lagos(10), available: true },
      { start: lagos(10, 30), available: true },
      { start: lagos(11), available: false },
    ]);
  });
});

describe("BR-A4 lead time and booking horizon", () => {
  it("hides slots sooner than the minimum lead time", () => {
    const slots = availableSlots({ ...base, now: new Date("2026-10-15T09:10:00Z") }); // 10:10 Lagos
    expect(slots[0]).toEqual(lagos(11, 30)); // 11:10 earliest → next grid slot
  });

  it("hides slots beyond the maximum advance window", () => {
    expect(availableSlots({ ...base, now: new Date("2026-09-01T08:00:00Z") })).toEqual([]);
  });

  it("aligns to the grid from local midnight", () => {
    const slots = availableSlots({ ...base, salonHours: [{ startMin: h(9, 10), endMin: h(19) }] });
    expect(slots[0]).toEqual(lagos(9, 30));
  });
});

describe("intersectRanges", () => {
  it("returns sorted overlaps only", () => {
    expect(
      intersectRanges(
        [{ startMin: 600, endMin: 900 }, { startMin: 0, endMin: 100 }],
        [{ startMin: 50, endMin: 700 }],
      ),
    ).toEqual([
      { startMin: 50, endMin: 100 },
      { startMin: 600, endMin: 700 },
    ]);
  });
});

describe("BR-A5 any barber", () => {
  it("picks the free barber with the fewest bookings, ties by staff order", () => {
    expect(
      pickAnyBarber([
        { barberId: "tunde", free: true, bookingsThatDay: 5, sortOrder: 0 },
        { barberId: "chidi", free: true, bookingsThatDay: 3, sortOrder: 1 },
        { barberId: "bayo", free: false, bookingsThatDay: 0, sortOrder: 2 },
      ]),
    ).toBe("chidi");
    expect(
      pickAnyBarber([
        { barberId: "b", free: true, bookingsThatDay: 2, sortOrder: 1 },
        { barberId: "a", free: true, bookingsThatDay: 2, sortOrder: 0 },
      ]),
    ).toBe("a");
  });
  it("returns null when nobody is free", () => {
    expect(pickAnyBarber([{ barberId: "a", free: false, bookingsThatDay: 0, sortOrder: 0 }])).toBeNull();
  });
});

describe("BR-A1 slots across daylight-saving changes (Europe/London)", () => {
  const london = (date: { year: number; month: number; day: number }) =>
    availableSlots({
      ...base,
      timeZone: "Europe/London",
      date,
      salonHours: [{ startMin: h(9), endMin: h(10) }],
      barberHours: [{ startMin: h(9), endMin: h(10) }],
      now: new Date(Date.UTC(date.year, date.month - 1, date.day - 2)),
    }).map((d) => d.toISOString());

  it("keeps 09:00 local on the day the clocks go back (BST → GMT)", () => {
    // Sun 25 Oct 2026: 09:00 GMT = 09:00 UTC.
    expect(london({ year: 2026, month: 10, day: 25 })).toEqual(["2026-10-25T09:00:00.000Z", "2026-10-25T09:30:00.000Z"]);
  });

  it("keeps 09:00 local on the day the clocks go forward (GMT → BST)", () => {
    // Sun 29 Mar 2026: 09:00 BST = 08:00 UTC.
    expect(london({ year: 2026, month: 3, day: 29 })).toEqual(["2026-03-29T08:00:00.000Z", "2026-03-29T08:30:00.000Z"]);
  });
});
