// Shared by online booking, staff bookings, walk-ins and reschedules.
import { pickAnyBarber } from "@/domain/availability";
import { localDateKey } from "@/domain/time";
import type { TenantTx } from "./audit";
import type { TenantDb } from "./db";
import { barberGrid } from "./slots";

export const ANY_BARBER = "any";
export const SLOT_TAKEN_MESSAGE = "Someone just booked that time. Please pick another.";

type SlotSalon = Parameters<typeof barberGrid>[1];

/**
 * BR-A1 + BR-A5 on the server: the barber who can take this exact start time, or null.
 * `ignoreBookingId` lets a reschedule ignore the booking being moved.
 */
export async function assignBarber(
  db: TenantDb,
  salon: SlotSalon,
  service: { durationMin: number; bufferMin: number },
  barberChoice: string,
  startsAt: Date,
  now: Date,
  ignoreBookingId?: string,
): Promise<{ id: string; displayName: string } | null> {
  const candidates =
    barberChoice === ANY_BARBER
      ? await db.barber.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
      : await db.barber.findMany({ where: { id: barberChoice, active: true } });
  const key = localDateKey(startsAt, salon.timezone);
  const options = await Promise.all(
    candidates.map(async (b) => {
      const grid = await barberGrid(db, salon, b.id, service, key, now, ignoreBookingId);
      return {
        barberId: b.id,
        free: grid.some((s) => s.available && s.start.getTime() === startsAt.getTime()),
        bookingsThatDay: grid.filter((s) => !s.available).length,
        sortOrder: b.sortOrder,
      };
    }),
  );
  const id = pickAnyBarber(options);
  return id ? (candidates.find((c) => c.id === id) ?? null) : null;
}

export function isOverlapError(err: unknown): boolean {
  const text = `${(err as { message?: string })?.message ?? ""} ${JSON.stringify(err)}`;
  return text.includes("booking_no_overlap") || text.includes("23P01");
}

function isUniqueError(err: unknown): boolean {
  return String(err).includes("Unique constraint") || JSON.stringify(err).includes("P2002");
}

function refPrefix(name: string): string {
  const letters = name.match(/[A-Za-z]+/g)?.map((w) => w[0].toUpperCase()) ?? [];
  return (letters.join("").slice(0, 3) || "BK").padEnd(2, "X");
}

/** Next human-readable booking ref (display only, never grants access). */
export async function nextRef(tx: TenantTx, salonName: string, attempt: number): Promise<string> {
  return `${refPrefix(salonName)}-${1001 + (await tx.booking.count()) + attempt}`;
}

/**
 * Runs `work` in a transaction. The double-booking constraint (BR-A3) maps to "slot_taken";
 * a unique clash (booking ref, or the same new customer from a parallel request) retries the
 * whole transaction, because a failed statement aborts it in Postgres.
 */
export async function saveBooking<T>(
  db: TenantDb,
  work: (tx: TenantTx, attempt: number) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: "slot_taken" }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { ok: true, value: await db.$transaction((tx) => work(tx, attempt)) };
    } catch (err) {
      if (isOverlapError(err)) return { ok: false, error: "slot_taken" };
      if (!isUniqueError(err)) throw err;
    }
  }
  throw new Error("Could not save the booking after 3 attempts");
}
