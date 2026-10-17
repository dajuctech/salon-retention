// NFR-DATA retention job against a real Postgres (security-privacy.md §Retention).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forSalon, unscopedDb } from "@/server/db";
import { runRetention } from "./retention";

const db = unscopedDb();
const NOW = new Date("2026-10-17T12:00:00Z");
const ago = (months: number) => {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

async function salonWithData(id: string) {
  await db.salon.deleteMany({ where: { id } });
  await db.salon.create({ data: { id, name: id, slug: id, countryCode: "NG", timezone: "Africa/Lagos", currency: "NGN" } });
  const t = forSalon(id);
  const barber = await t.barber.create({ data: { displayName: "Tunde" } as never });
  const service = await t.service.create({ data: { name: "Haircut", durationMin: 30, priceMinor: 300_000, currency: "NGN" } as never });
  const customer = (name: string, phone: string, lastVisitAt: Date | null, createdAt = ago(30)) =>
    t.customer.create({ data: { name, phoneE164: phone, lastVisitAt, createdAt, marketingConsent: true, utilityConsent: true, notes: "likes a fade" } as never });
  const booking = (customerId: string, startsAt: Date, ref: string) =>
    t.booking.create({
      data: { ref, customerId, barberId: barber.id, serviceId: service.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), status: "COMPLETED", source: "STAFF", priceMinor: 300_000, currency: "NGN" } as never,
    });
  const lapsed = await customer("Lapsed Lola", "+2348030000001", ago(25));
  const recent = await customer("Recent Remi", "+2348030000002", ago(3));
  const neverVisited = await customer("Signup Sam", "+2348030000003", null, ago(26));
  const comingBack = await customer("Booked Bola", "+2348030000004", ago(25));
  await booking(lapsed.id, ago(25), "R-1");
  await booking(recent.id, ago(3), "R-2");
  await booking(comingBack.id, new Date(NOW.getTime() + 3 * 86_400_000), "R-3"); // upcoming
  const ancient = await booking(recent.id, ago(6 * 12 + 1), "R-4");
  await t.payment.create({ data: { bookingId: ancient.id, method: "CASH", amountMinor: 300_000, currency: "NGN" } as never });

  const msg = (customerId: string, createdAt: Date, key: string) =>
    t.message.create({ data: { customerId, type: "REMINDER_2H", renderedText: "Hi Remi, see you at 2pm", status: "DELIVERED", idempotencyKey: `${id}-${key}`, scheduledFor: createdAt, createdAt } as never });
  await msg(recent.id, ago(13), "old-text");
  await msg(recent.id, ago(25), "old-row");
  await msg(recent.id, ago(1), "fresh");
  const conv = await t.conversation.create({ data: { customerId: recent.id, phoneE164: recent.phoneE164 } as never });
  await t.inboundMessage.create({ data: { conversationId: conv.id, providerMessageId: `${id}-in-old`, text: "Can I come at 5?", receivedAt: ago(13) } as never });
  await t.inboundMessage.create({ data: { conversationId: conv.id, providerMessageId: `${id}-in-new`, text: "Thanks!", receivedAt: ago(1) } as never });
  await t.aIGeneration.create({ data: { feature: "copy_assistant", promptVersion: "v2", provider: "fake", model: "fake", input: {}, createdAt: ago(13) } as never });
  await t.aIGeneration.create({ data: { feature: "copy_assistant", promptVersion: "v2", provider: "fake", model: "fake", input: {}, createdAt: ago(1) } as never });
  await t.auditLog.create({ data: { actorType: "staff", action: "x.old", entityType: "X", entityId: "1", createdAt: ago(25) } as never });
  await t.auditLog.create({ data: { actorType: "staff", action: "x.new", entityType: "X", entityId: "2", createdAt: ago(1) } as never });
  return { t, lapsed, recent, neverVisited, comingBack, ancient };
}

let a: Awaited<ReturnType<typeof salonWithData>>;
let b: Awaited<ReturnType<typeof salonWithData>>;

beforeAll(async () => {
  a = await salonWithData("ret-a");
  b = await salonWithData("ret-b");
});

afterAll(async () => {
  await db.salon.deleteMany({ where: { id: { in: ["ret-a", "ret-b"] } } });
  await db.$disconnect();
});

describe("NFR-DATA retention job", () => {
  it("applies each retention rule to one salon only", async () => {
    const sum = await runRetention({ now: NOW, salonId: "ret-a" });
    expect(sum).toMatchObject({ customersAnonymised: 2, messagesRedacted: 1, messagesDeleted: 1, inboundRedacted: 1, aiLogsDeleted: 1, bookingsDeleted: 1 });

    // Customers: inactive 24 months (or signed up 24+ months ago, never visited) → anonymised.
    const people = await a.t.customer.findMany({ orderBy: { phoneE164: "asc" } });
    const byId = new Map(people.map((p) => [p.id, p]));
    expect(byId.get(a.lapsed.id)).toMatchObject({ name: "Deleted customer", notes: null, marketingConsent: false });
    expect(byId.get(a.neverVisited.id)?.anonymisedAt).not.toBeNull();
    expect(byId.get(a.recent.id)).toMatchObject({ name: "Recent Remi", anonymisedAt: null });
    expect(byId.get(a.comingBack.id)).toMatchObject({ name: "Booked Bola", anonymisedAt: null }); // has an upcoming booking
    // Their anonymous visit history stays for reports.
    expect(await a.t.booking.count({ where: { customerId: a.lapsed.id } })).toBe(1);

    // Messages: text removed after 12 months, rows deleted after 24; recent ones untouched.
    const texts = (await a.t.message.findMany({ where: { customerId: a.recent.id }, orderBy: { createdAt: "asc" } })).map((m) => m.renderedText);
    expect(texts).toEqual(["[expired]", "Hi Remi, see you at 2pm"]);
    expect((await a.t.inboundMessage.findMany({ orderBy: { receivedAt: "asc" } })).map((m) => m.text)).toEqual(["[expired]", "Thanks!"]);
    expect(await a.t.aIGeneration.count()).toBe(1);
    // Audit log entries older than 24 months go; the job's own anonymisation entries are new.
    expect(await a.t.auditLog.count({ where: { action: "x.old" } })).toBe(0);
    expect(await a.t.auditLog.count({ where: { action: "customer.anonymised_retention" } })).toBe(2);
    // Financial records older than 6 years go, with their payments.
    expect(await a.t.booking.findFirst({ where: { id: a.ancient.id } })).toBeNull();
    expect(await a.t.payment.count({ where: { bookingId: a.ancient.id } })).toBe(0);

    // The other salon is untouched.
    expect(await b.t.customer.count({ where: { anonymisedAt: { not: null } } })).toBe(0);
    expect(await b.t.message.count()).toBe(3);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const again = await runRetention({ now: NOW, salonId: "ret-a" });
    expect(again).toMatchObject({ customersAnonymised: 0, messagesRedacted: 0, messagesDeleted: 0, inboundRedacted: 0, aiLogsDeleted: 0, auditLogsDeleted: 0, bookingsDeleted: 0 });
  });

  it("cleans up stale rate-limit counters, sign-in codes and sessions platform-wide", async () => {
    const weekAgo = Math.floor(NOW.getTime() / 1000) - 8 * 86_400;
    await db.rateLimitHit.createMany({ data: [{ key: "old", window: weekAgo }, { key: "new", window: Math.floor(NOW.getTime() / 1000) }] });
    await db.verification.create({ data: { id: "ret-v", identifier: "x", value: "123456", expiresAt: new Date(NOW.getTime() - 2 * 86_400_000) } });
    const sum = await runRetention({ now: NOW });
    expect(sum.housekeeping).toBeGreaterThanOrEqual(2);
    expect(await db.rateLimitHit.findMany({ where: { key: { in: ["old", "new"] } }, select: { key: true } })).toEqual([{ key: "new" }]);
    expect(await db.verification.findUnique({ where: { id: "ret-v" } })).toBeNull();
    await db.rateLimitHit.deleteMany({ where: { key: "new" } });
  });
});
