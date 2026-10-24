// Integration tests for public online booking (US-10, US-18) against a real Postgres.
// Requires DATABASE_URL pointing at a migrated, disposable test database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atLocal, localParts } from "@/domain/time";
import { ANY_BARBER, createOnlineBooking, slotsFor, type BookingInput } from "./booking";
import { findSalonBySlug, forSalon, unscopedDb, type PublicSalon } from "./db";

const db = unscopedDb();
const TZ = "Africa/Lagos";
const h = (hh: number) => hh * 60;

async function makeSalon(id: string) {
  await db.salon.create({
    data: {
      id,
      name: "Sharp & Co.",
      slug: id,
      countryCode: "NG",
      timezone: TZ,
      currency: "NGN",
      slotGridMinutes: 30,
      openingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: h(9), endMin: h(18) })) },
    },
  });
  const t = forSalon(id);
  const service = await t.service.create({
    data: { salonId: id, name: "Haircut", durationMin: 30, priceMinor: 300_000, currency: "NGN" },
  });
  const barbers = [];
  for (const [i, name] of ["Tunde", "Chidi"].entries()) {
    barbers.push(
      await t.barber.create({
        data: {
          salonId: id,
          displayName: name,
          sortOrder: i,
          workingHours: {
            create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ salonId: id, weekday, startMin: h(9), endMin: h(18) })),
          },
        },
      }),
    );
  }
  return { salon: (await findSalonBySlug(id)) as PublicSalon, t, service, tunde: barbers[0], chidi: barbers[1] };
}

// A day 3 days from now, so every slot is beyond the minimum lead time.
const day = localParts(new Date(Date.now() + 3 * 86_400_000), TZ);
const dayKey = `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
const at = (hh: number, mm = 0) => atLocal(TZ, day.year, day.month, day.day, hh, mm);

let a: Awaited<ReturnType<typeof makeSalon>>;
let b: Awaited<ReturnType<typeof makeSalon>>;

const input = (patch: Partial<BookingInput> = {}): BookingInput => ({
  serviceId: a.service.id,
  barber: ANY_BARBER,
  startsAt: at(10).toISOString(),
  name: "Tolu Bakare",
  phone: "0803 123 4567",
  marketing: false,
  ...patch,
});

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "salon" CASCADE');
  a = await makeSalon("booking-a");
  b = await makeSalon("booking-b");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("createOnlineBooking", () => {
  it("creates the customer, the booking and utility consent only", async () => {
    const result = await createOnlineBooking(a.salon, input());
    expect(result.ok).toBe(true);
    const booking = await a.t.booking.findFirstOrThrow({ where: { id: result.ok ? result.bookingId : "" } });
    expect(booking).toMatchObject({ status: "CONFIRMED", source: "ONLINE", priceMinor: 300_000 });
    expect(booking.ref).toMatch(/^SC-\d{4}$/);

    const customer = await a.t.customer.findFirstOrThrow({ where: { phoneE164: "+2348031234567" } });
    const consents = await a.t.consent.findMany({ where: { customerId: customer.id } });
    expect(consents.map((c) => c.purpose)).toEqual(["UTILITY"]); // BR-R1: marketing never assumed
    expect(consents[0].wording).toContain("WhatsApp");
  });

  it("BR-I2 reuses the customer by phone and never overwrites their name from a public form", async () => {
    const result = await createOnlineBooking(
      a.salon,
      input({ startsAt: at(11).toISOString(), name: "Someone Else", phone: "+234 803 123 4567", marketing: true }),
    );
    expect(result.ok).toBe(true);
    const customers = await a.t.customer.findMany({ where: { phoneE164: "+2348031234567" } });
    expect(customers).toHaveLength(1);
    expect(customers[0].name).toBe("Tolu Bakare");
    const marketing = await a.t.consent.findMany({ where: { customerId: customers[0].id, purpose: "MARKETING" } });
    expect(marketing).toHaveLength(1);
    // A repeat booking doesn't add another identical utility consent row.
    const utility = await a.t.consent.findMany({ where: { customerId: customers[0].id, purpose: "UTILITY" } });
    expect(utility).toHaveLength(1);
  });

  it("BR-A5 assigns 'any barber' to whoever is free", async () => {
    await createOnlineBooking(a.salon, input({ barber: a.tunde.id, startsAt: at(14).toISOString(), phone: "08031111111" }));
    const result = await createOnlineBooking(a.salon, input({ startsAt: at(14).toISOString(), phone: "08032222222" }));
    expect(result.ok).toBe(true);
    const booking = await a.t.booking.findFirstOrThrow({ where: { id: result.ok ? result.bookingId : "" } });
    expect(booking.barberId).toBe(a.chidi.id);
  });

  it("returns slot_taken when every barber is busy at that time", async () => {
    await createOnlineBooking(a.salon, input({ barber: a.tunde.id, startsAt: at(15).toISOString(), phone: "08033333333" }));
    await createOnlineBooking(a.salon, input({ barber: a.chidi.id, startsAt: at(15).toISOString(), phone: "08034444444" }));
    const result = await createOnlineBooking(a.salon, input({ startsAt: at(15).toISOString(), phone: "08035555555" }));
    expect(result).toMatchObject({ ok: false, error: "slot_taken" });
  });

  it("BR-A3 lets only one of two simultaneous requests win the same barber and time", async () => {
    const results = await Promise.all(
      ["08036666661", "08036666662"].map((phone) =>
        createOnlineBooking(a.salon, input({ barber: a.tunde.id, startsAt: at(16).toISOString(), phone })),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "slot_taken" });
  });

  it("a lost race leaves no customer or consent behind (found in the e2e data review)", async () => {
    const phones = ["+2348037777771", "+2348037777772"];
    const results = await Promise.all(
      phones.map((phone) =>
        createOnlineBooking(a.salon, input({ barber: a.tunde.id, startsAt: at(17).toISOString(), phone })),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const customers = await db.customer.findMany({ where: { phoneE164: { in: phones } } });
    expect(customers).toHaveLength(1); // only the winner
    expect(await db.consent.count({ where: { customerId: { notIn: customers.map((c) => c.id) }, customer: { phoneE164: { in: phones } } } })).toBe(0);
    // The transaction still goes through the tenant guard.
    expect(customers[0].salonId).toBe("booking-a");
  });

  it("BR-A1 rejects times outside opening hours or off the slot grid", async () => {
    expect(await createOnlineBooking(a.salon, input({ startsAt: at(20).toISOString() }))).toMatchObject({
      ok: false,
      error: "slot_taken",
    });
    expect(await createOnlineBooking(a.salon, input({ startsAt: at(10, 10).toISOString() }))).toMatchObject({
      ok: false,
      error: "slot_taken",
    });
  });

  it("BR-I1 rejects an invalid phone number", async () => {
    expect(await createOnlineBooking(a.salon, input({ phone: "123456" }))).toMatchObject({
      ok: false,
      error: "invalid_phone",
      message: expect.stringContaining("start with + and the country code"),
    });
  });

  it("ADR-0002 refuses another salon's service or barber ids", async () => {
    expect(await createOnlineBooking(a.salon, input({ serviceId: b.service.id }))).toMatchObject({
      ok: false,
      error: "invalid",
    });
    expect(
      await createOnlineBooking(a.salon, input({ barber: b.tunde.id, startsAt: at(12).toISOString() })),
    ).toMatchObject({ ok: false, error: "slot_taken" });
    expect(await db.booking.count({ where: { salonId: "booking-b" } })).toBe(0);
  });
});

describe("slotsFor", () => {
  it("marks taken times as unavailable and keeps free ones", async () => {
    const slots = await slotsFor(a.salon, a.service.id, a.tunde.id, dayKey);
    const byTime = new Map(slots.map((s) => [s.iso, s.available]));
    expect(byTime.get(at(10).toISOString())).toBe(false); // booked in the first test
    expect(byTime.get(at(9).toISOString())).toBe(true);
    expect(slots.at(-1)?.iso).toBe(at(17, 30).toISOString()); // last 30-min cut ends at 18:00
  });

  it("treats a time as free for 'any barber' while one barber is still free", async () => {
    const any = new Map((await slotsFor(a.salon, a.service.id, ANY_BARBER, dayKey)).map((s) => [s.iso, s.available]));
    expect(any.get(at(14).toISOString())).toBe(false); // both barbers booked at 14:00
    expect(any.get(at(10).toISOString())).toBe(true); // only Tunde booked at 10:00
  });

  it("returns nothing for a closed date", async () => {
    await a.t.closedDate.create({ data: { salonId: "booking-a", date: new Date(`${dayKey}T00:00:00Z`) } });
    expect(await slotsFor(a.salon, a.service.id, ANY_BARBER, dayKey)).toEqual([]);
  });

  it("returns nothing for another salon's service", async () => {
    expect(await slotsFor(a.salon, b.service.id, ANY_BARBER, dayKey)).toEqual([]);
  });
});
