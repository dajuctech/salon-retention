// Slot calculation (BR-A1, BR-A4, BR-A5). The database exclusion constraint (BR-A3)
// is the final guard against races; this module decides what to offer.
import { DAY_MS, MINUTE_MS, atLocal } from "./time";

/** Minutes from salon-local midnight, end exclusive. */
export type MinuteRange = { startMin: number; endMin: number };
export type Interval = { start: Date; end: Date };

export type SlotQuery = {
  timeZone: string;
  date: { year: number; month: number; day: number }; // salon-local, month 1–12
  closed: boolean; // ClosedDate for this day
  salonHours: readonly MinuteRange[]; // for this weekday
  barberHours: readonly MinuteRange[]; // for this weekday
  busy: readonly Interval[]; // blocking bookings + time off for this barber
  durationMin: number;
  bufferMin: number;
  gridMin: number;
  now: Date;
  minLeadMin: number;
  maxAdvanceDays: number;
};

export function intersectRanges(a: readonly MinuteRange[], b: readonly MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const x of a) {
    for (const y of b) {
      const startMin = Math.max(x.startMin, y.startMin);
      const endMin = Math.min(x.endMin, y.endMin);
      if (startMin < endMin) out.push({ startMin, endMin });
    }
  }
  return out.sort((p, q) => p.startMin - q.startMin);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export type GridSlot = { start: Date; available: boolean };

/**
 * Every bookable-hours slot for the day, marked available or taken, so the UI can show
 * taken times struck through (design p1). Slots outside the lead/advance window are omitted.
 */
export function slotGrid(q: SlotQuery): GridSlot[] {
  if (q.closed) return [];
  const earliest = q.now.getTime() + q.minLeadMin * MINUTE_MS;
  const latest = q.now.getTime() + q.maxAdvanceDays * DAY_MS;
  const slots: GridSlot[] = [];

  for (const window of intersectRanges(q.salonHours, q.barberHours)) {
    const first = Math.ceil(window.startMin / q.gridMin) * q.gridMin;
    // The service itself must finish before closing; the buffer may run past it.
    for (let m = first; m + q.durationMin <= window.endMin; m += q.gridMin) {
      const start = atLocal(q.timeZone, q.date.year, q.date.month, q.date.day, 0, m);
      if (start.getTime() < earliest || start.getTime() > latest) continue;
      const blocked: Interval = {
        start,
        end: new Date(start.getTime() + (q.durationMin + q.bufferMin) * MINUTE_MS),
      };
      slots.push({ start, available: !q.busy.some((b) => overlaps(blocked, b)) });
    }
  }
  return slots;
}

export function availableSlots(q: SlotQuery): Date[] {
  return slotGrid(q)
    .filter((s) => s.available)
    .map((s) => s.start);
}

/** Merges per-barber grids for "Any barber": a time is available if any barber is free then. */
export function mergeGrids(grids: readonly GridSlot[][]): GridSlot[] {
  const byTime = new Map<number, boolean>();
  for (const grid of grids) {
    for (const s of grid) byTime.set(s.start.getTime(), (byTime.get(s.start.getTime()) ?? false) || s.available);
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, available]) => ({ start: new Date(t), available }));
}

export type AnyBarberCandidate = { barberId: string; free: boolean; bookingsThatDay: number; sortOrder: number };

/** BR-A5: the free barber with the fewest bookings that day; ties by staff order. */
export function pickAnyBarber(candidates: readonly AnyBarberCandidate[]): string | null {
  const free = candidates.filter((c) => c.free);
  if (free.length === 0) return null;
  free.sort((a, b) => a.bookingsThatDay - b.bookingsThatDay || a.sortOrder - b.sortOrder);
  return free[0].barberId;
}
