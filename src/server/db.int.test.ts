// Integration tests against a real Postgres (docs/testing-strategy.md).
// Requires DATABASE_URL pointing at a migrated, disposable test database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forSalon, unscopedDb } from "./db";

const db = unscopedDb();

async function makeSalon(id: string) {
  await db.salon.create({
    data: { id, name: id, slug: id, countryCode: "NG", timezone: "Africa/Lagos", currency: "NGN" },
  });
  const t = forSalon(id);
  const barber = await t.barber.create({ data: { displayName: "Tunde" } as never });
  const service = await t.service.create({
    data: { name: "Haircut", durationMin: 30, priceMinor: 300_000, currency: "NGN" } as never,
  });
  const customer = await t.customer.create({ data: { name: `Customer ${id}`, phoneE164: "+2348031234567" } as never });
  return { t, barber, service, customer };
}

let a: Awaited<ReturnType<typeof makeSalon>>;
let b: Awaited<ReturnType<typeof makeSalon>>;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "salon" CASCADE');
  a = await makeSalon("salon-a");
  b = await makeSalon("salon-b");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("ADR-0002 tenant isolation through forSalon()", () => {
  it("only lists the salon's own rows", async () => {
    const rows = await a.t.customer.findMany();
    expect(rows.map((r) => r.salonId)).toEqual(["salon-a"]);
  });

  it("cannot read another salon's row by id", async () => {
    expect(await a.t.customer.findUnique({ where: { id: b.customer.id } })).toBeNull();
    expect(await a.t.customer.findFirst({ where: { id: b.customer.id } })).toBeNull();
  });

  it("cannot update or delete another salon's rows", async () => {
    const updated = await a.t.customer.updateMany({ where: { id: b.customer.id }, data: { name: "hacked" } });
    expect(updated.count).toBe(0);
    await expect(a.t.customer.update({ where: { id: b.customer.id }, data: { name: "hacked" } })).rejects.toThrow();
    const deleted = await a.t.customer.deleteMany({ where: { id: b.customer.id } });
    expect(deleted.count).toBe(0);
    expect((await db.customer.findUnique({ where: { id: b.customer.id } }))?.name).toBe("Customer salon-b");
  });

  it("forces salonId on create and ignores attempts to move a row", async () => {
    const c = await a.t.customer.create({
      data: { name: "Sneaky", phoneE164: "+2348039999999", salonId: "salon-b" } as never,
    });
    expect(c.salonId).toBe("salon-a");
    await a.t.customer.update({ where: { id: c.id }, data: { salonId: "salon-b" } as never });
    expect((await db.customer.findUnique({ where: { id: c.id } }))?.salonId).toBe("salon-a");
  });

  it("BR-I2 allows the same phone in different salons but not twice in one", async () => {
    expect(b.customer.phoneE164).toBe(a.customer.phoneE164);
    await expect(
      a.t.customer.create({ data: { name: "Dup", phoneE164: "+2348031234567" } as never }),
    ).rejects.toThrow();
  });

  it("lets salons read platform templates but not edit them", async () => {
    await db.messageTemplate.create({
      data: { name: "reminder_2h_v1", type: "REMINDER_2H", category: "UTILITY", body: "…", variables: [] },
    });
    await b.t.messageTemplate.create({
      data: { name: "winback_friendly_v1", type: "WINBACK", category: "MARKETING", body: "…", variables: [] } as never,
    });
    const visible = await a.t.messageTemplate.findMany();
    expect(visible.map((t) => t.name)).toEqual(["reminder_2h_v1"]);
    const edited = await a.t.messageTemplate.updateMany({ where: {}, data: { body: "changed" } });
    expect(edited.count).toBe(0);
  });
});

describe("BR-A3 database prevents double booking", () => {
  const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00Z`);
  const booking = (ref: string, start: string, end: string, extra: object = {}) =>
    a.t.booking.create({
      data: {
        ref,
        customerId: a.customer.id,
        barberId: a.barber.id,
        serviceId: a.service.id,
        startsAt: at(start),
        endsAt: at(end),
        status: "CONFIRMED",
        source: "ONLINE",
        priceMinor: 300_000,
        currency: "NGN",
        ...extra,
      } as never,
    });

  it("rejects an overlapping booking for the same barber", async () => {
    await booking("SC-1", "10:00", "10:30");
    await expect(booking("SC-2", "10:15", "10:45")).rejects.toThrow();
  });

  it("allows back-to-back bookings (end is exclusive)", async () => {
    await expect(booking("SC-3", "10:30", "11:00")).resolves.toBeTruthy();
  });

  it("ignores cancelled bookings and walk-ins (BR-A2, BR-A6)", async () => {
    await expect(booking("SC-4", "10:00", "10:30", { status: "CANCELLED" })).resolves.toBeTruthy();
    await expect(booking("SC-5", "10:00", "10:30", { source: "WALK_IN", status: "IN_PROGRESS" })).resolves.toBeTruthy();
  });

  it("rejects one of two simultaneous requests for the same slot", async () => {
    const results = await Promise.allSettled([booking("SC-6", "12:00", "12:30"), booking("SC-7", "12:00", "12:30")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("ADR-0002 hardening: the database refuses links between salons", () => {
  const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);
  it("rejects a booking that points at another salon's customer, barber or service, even unscoped", async () => {
    const base = {
      salonId: "salon-a",
      ref: "X-1",
      startsAt: at("10:00"),
      endsAt: at("10:30"),
      status: "CONFIRMED" as const,
      source: "STAFF" as const,
      priceMinor: 100,
      currency: "NGN",
    };
    for (const wrong of [
      { customerId: b.customer.id, barberId: a.barber.id, serviceId: a.service.id },
      { customerId: a.customer.id, barberId: b.barber.id, serviceId: a.service.id },
      { customerId: a.customer.id, barberId: a.barber.id, serviceId: b.service.id },
    ]) {
      await expect(db.booking.create({ data: { ...base, ...wrong } })).rejects.toThrow(/cross_salon_reference/);
    }
  });

  it("rejects moving a row's reference to another salon on update", async () => {
    const ok = await db.booking.create({
      data: { salonId: "salon-a", ref: "X-2", customerId: a.customer.id, barberId: a.barber.id, serviceId: a.service.id, startsAt: at("11:00"), endsAt: at("11:30"), status: "CONFIRMED", source: "STAFF", priceMinor: 100, currency: "NGN" },
    });
    await expect(db.booking.update({ where: { id: ok.id }, data: { customerId: b.customer.id } })).rejects.toThrow(/cross_salon_reference/);
    await expect(db.payment.create({ data: { salonId: "salon-b", bookingId: ok.id, method: "CASH", amountMinor: 100, currency: "NGN" } })).rejects.toThrow(/cross_salon_reference/);
  });

  it("still allows platform-wide templates on any salon's messages", async () => {
    const platform = await db.messageTemplate.findFirstOrThrow({ where: { salonId: null } });
    const ownB = await db.messageTemplate.findFirstOrThrow({ where: { salonId: "salon-b" } });
    const msg = (templateId: string, key: string) =>
      db.message.create({ data: { salonId: "salon-a", customerId: a.customer.id, type: "REMINDER_2H", templateId, renderedText: "x", status: "SKIPPED", idempotencyKey: key, scheduledFor: at("09:00") } });
    await expect(msg(platform.id, "shared-ok")).resolves.toBeTruthy();
    await expect(msg(ownB.id, "other-salon")).rejects.toThrow(/cross_salon_reference/);
  });
});
