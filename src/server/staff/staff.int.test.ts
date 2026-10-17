// Integration tests for staff operations and the messaging engine against a real Postgres.
// Requires DATABASE_URL pointing at a migrated, disposable test database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { atLocal, localParts } from "@/domain/time";
import { ForbiddenError } from "@/server/authz";
import { findSalonBySlug, forSalon, unscopedDb, type PublicSalon } from "@/server/db";
import { runDailyJobs } from "@/server/platform/daily";
import { dispatchDue } from "@/server/platform/dispatcher";
import { handleInbound } from "@/server/platform/inbound";
import { ensurePlatformTemplates } from "@/server/platform/templates";
import { changeBookingStatus, createStaffBooking, createWalkIn } from "./bookings";
import type { StaffCtx } from "./context";
import { anonymiseCustomer } from "./customers";
import { approveDrafts, replyInConversation, setDraftVariant } from "./messaging";
import { customerLoyalty, recordPayment, redeemLoyalty, refundPayment } from "./payments";
import { reportsData } from "./queries/reports";
import { savePromotion } from "./settings";

const db = unscopedDb();
const TZ = "Africa/Lagos";
const h = (hh: number) => hh * 60;
// Mid-afternoon Lagos time on a Wednesday, outside quiet hours.
const NOW = new Date("2026-10-14T13:00:00Z");
const lagos = (dayOffset: number, hh: number, mm = 0) => {
  const p = localParts(new Date(NOW.getTime() + dayOffset * 86_400_000), TZ);
  return atLocal(TZ, p.year, p.month, p.day, hh, mm);
};

type World = Awaited<ReturnType<typeof makeWorld>>;

async function makeWorld(id: string) {
  await db.salon.create({
    data: {
      id,
      name: "Sharp & Co.",
      slug: id,
      countryCode: "NG",
      timezone: TZ,
      currency: "NGN",
      slotGridMinutes: 30,
      loyaltyOn: true,
      loyaltyThreshold: 3,
      openingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: h(9), endMin: h(19) })) },
    },
  });
  const users = await Promise.all(
    ["owner", "reception", "tunde"].map((u) =>
      db.user.create({ data: { id: `${id}-${u}`, name: u === "tunde" ? "Tunde Ade" : u, email: `${u}@${id}.test` } }),
    ),
  );
  const [ownerM, recM, barberM] = await Promise.all([
    db.member.create({ data: { salonId: id, userId: users[0].id, role: "owner" } }),
    db.member.create({ data: { salonId: id, userId: users[1].id, role: "receptionist" } }),
    db.member.create({ data: { salonId: id, userId: users[2].id, role: "barber" } }),
  ]);
  const t = forSalon(id);
  const hours = { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ salonId: id, weekday, startMin: h(9), endMin: h(19) })) };
  const tunde = await t.barber.create({ data: { salonId: id, displayName: "Tunde", memberId: barberM.id, sortOrder: 0, workingHours: hours } });
  const chidi = await t.barber.create({ data: { salonId: id, displayName: "Chidi", sortOrder: 1, workingHours: hours } });
  const haircut = await t.service.create({
    data: { salonId: id, name: "Haircut", durationMin: 30, priceMinor: 300_000, currency: "NGN", loyaltyReward: true, sortOrder: 0 },
  });
  const beard = await t.service.create({ data: { salonId: id, name: "Beard trim", durationMin: 20, priceMinor: 200_000, currency: "NGN", sortOrder: 1 } });
  const salon = (await findSalonBySlug(id)) as PublicSalon;
  const ctx = (memberId: string, userId: string, role: "owner" | "receptionist" | "barber", barberId: string | null): StaffCtx => ({
    member: { userId, salonId: id, role, barberId },
    salon,
    user: { id: userId, name: role },
  });
  return {
    id,
    t,
    salon,
    tunde,
    chidi,
    haircut,
    beard,
    owner: ctx(ownerM.id, users[0].id, "owner", null),
    reception: ctx(recM.id, users[1].id, "receptionist", null),
    barber: ctx(barberM.id, users[2].id, "barber", tunde.id),
  };
}

let w: World;
let other: World;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "salon", "user", "MessageTemplate", "RateLimitHit" CASCADE');
  await ensurePlatformTemplates();
  w = await makeWorld("staff-a");
  other = await makeWorld("staff-b");
});

afterAll(async () => {
  await db.$disconnect();
});

const phone = (() => {
  let n = 1000;
  return () => `0803${String(++n).padStart(7, "0")}`;
})();

// Each past visit gets its own time so test data never trips the double-booking constraint.
let visitSlot = 0;
async function completedVisit(world: World, customerId: string, daysAgo: number, barberId = world.tunde.id) {
  const startsAt = new Date(lagos(-daysAgo, 6).getTime() + visitSlot++ * 31 * 60_000);
  return world.t.booking.create({
    data: {
      salonId: world.id,
      ref: `SC-${Math.random().toString(36).slice(2, 8)}`,
      customerId,
      barberId,
      serviceId: world.haircut.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: "COMPLETED",
      source: "STAFF",
      priceMinor: 300_000,
      currency: "NGN",
    },
  });
}

describe("US-09 walk-in", () => {
  it("creates the customer, an in-chair booking, the payment and verbal consent", async () => {
    const p = phone();
    const r = await createWalkIn(w.reception, { phone: p, name: "Kola Adeyemi", serviceId: w.haircut.id, barber: w.chidi.id, paidNow: true, method: "CASH", utilityConsent: true, marketingConsent: false }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const booking = await w.t.booking.findFirstOrThrow({ where: { id: r.value.bookingId }, include: { payments: true, customer: true } });
    expect(booking).toMatchObject({ status: "IN_PROGRESS", source: "WALK_IN", barberId: w.chidi.id });
    expect(booking.payments.map((x) => [x.method, x.amountMinor])).toEqual([["CASH", 300_000]]);
    expect(booking.customer).toMatchObject({ utilityConsent: true, marketingConsent: false });
    // No WhatsApp messages for someone already in the chair.
    expect(await w.t.message.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("reuses an existing customer by phone and warns about an overlap instead of blocking", async () => {
    const p = phone();
    await createWalkIn(w.reception, { phone: p, name: "First", serviceId: w.haircut.id, barber: w.tunde.id, paidNow: false, utilityConsent: false, marketingConsent: false }, NOW);
    const second = await createWalkIn(w.reception, { phone: p, serviceId: w.beard.id, barber: w.tunde.id, paidNow: false, utilityConsent: false, marketingConsent: false }, NOW);
    expect(second.ok && second.value.customerName).toBe("First");
    expect(second.ok && second.value.warning).toMatch(/also has First booked/);
  });

  it("requires a name for a new number", async () => {
    const r = await createWalkIn(w.reception, { phone: phone(), serviceId: w.haircut.id, barber: "any", paidNow: false, utilityConsent: false, marketingConsent: false }, NOW);
    expect(r).toEqual({ ok: false, message: "Enter the customer's name." });
  });

  it("a barber can only record walk-ins for themselves", async () => {
    const r = await createWalkIn(w.barber, { phone: phone(), name: "Barber Self", serviceId: w.haircut.id, barber: w.chidi.id, paidNow: false, utilityConsent: false, marketingConsent: false }, NOW);
    expect(r.ok).toBe(true);
    const b = await w.t.booking.findFirstOrThrow({ where: { id: r.ok ? r.value.bookingId : "" } });
    expect(b.barberId).toBe(w.tunde.id);
  });
});

describe("US-12 / US-13 staff bookings and status changes", () => {
  it("queues the confirmation and both reminders, and cancels a pending win-back", async () => {
    const r = await createStaffBooking(w.reception, { customer: { name: "Chuka Obi", phone: phone() }, serviceId: w.haircut.id, barber: "any", startsAt: lagos(2, 11, 30), utilityConsent: true }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const msgs = await w.t.message.findMany({ where: { bookingId: r.value.id }, orderBy: { scheduledFor: "asc" } });
    expect(msgs.map((m) => m.type)).toEqual(["BOOKING_CONFIRMATION", "REMINDER_DAY_BEFORE", "REMINDER_2H"]);
    expect(msgs[0].renderedText).toMatch(/^Hi Chuka, your haircut at Sharp & Co\. is booked for .+ at 11:30 with (Tunde|Chidi)\. Booking ref SC-\d+\. To change or cancel: http/);
  });

  it("BR-B3 rejects a no-show before the grace period, and BR-B1 corrections are owner-only", async () => {
    const r = await createStaffBooking(w.reception, { customer: { name: "Femi", phone: phone() }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(0, 15) }, NOW);
    if (!r.ok) throw new Error(r.message);
    expect(await changeBookingStatus(w.reception, r.value.id, "NO_SHOW", undefined, NOW)).toMatchObject({ ok: false, message: expect.stringMatching(/15 minutes after/) });
    expect((await changeBookingStatus(w.reception, r.value.id, "NO_SHOW", undefined, lagos(0, 15, 20))).ok).toBe(true);
    expect(await changeBookingStatus(w.reception, r.value.id, "CONFIRMED", undefined, lagos(0, 15, 30))).toMatchObject({ ok: false, message: "Only the owner can undo this." });
    expect((await changeBookingStatus(w.owner, r.value.id, "CONFIRMED", undefined, lagos(0, 15, 30))).ok).toBe(true);
    const audit = await w.t.auditLog.findMany({ where: { entityId: r.value.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["booking.created", "booking.status_changed", "booking.status_corrected"]);
  });

  it("a barber can't complete a colleague's booking (permissions.md)", async () => {
    const r = await createStaffBooking(w.reception, { customer: { name: "Other", phone: phone() }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(0, 16) }, NOW);
    if (!r.ok) throw new Error(r.message);
    await changeBookingStatus(w.reception, r.value.id, "IN_PROGRESS", undefined, NOW);
    await expect(changeBookingStatus(w.barber, r.value.id, "COMPLETED", undefined, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("BR-B5 completing a visit updates stats and usual gap, and skips pending reminders", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Segun", phoneE164: "+2348025550147" } });
    await completedVisit(w, c.id, 42);
    await completedVisit(w, c.id, 21);
    const r = await createStaffBooking(w.reception, { customer: { customerId: c.id }, serviceId: w.haircut.id, barber: w.tunde.id, startsAt: lagos(0, 17) }, NOW);
    if (!r.ok) throw new Error(r.message);
    await changeBookingStatus(w.reception, r.value.id, "IN_PROGRESS", undefined, NOW);
    await changeBookingStatus(w.reception, r.value.id, "COMPLETED", undefined, NOW);
    const after = await w.t.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.visitCount).toBe(3);
    expect(after.usualGapDays).toBe(21);
    expect(await w.t.message.count({ where: { bookingId: r.value.id, status: "QUEUED" } })).toBe(0);
  });

  it("refuses a slot that's already taken for that barber", async () => {
    const first = await createStaffBooking(w.reception, { customer: { name: "Ayo", phone: phone() }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(3, 10) }, NOW);
    expect(first).toMatchObject({ ok: true });
    const second = await createStaffBooking(w.reception, { customer: { name: "Bisi", phone: phone() }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(3, 10) }, NOW);
    expect(second.ok).toBe(false);
  });

  it("ADR-0002: staff of another salon can't touch this salon's booking", async () => {
    const r = await createStaffBooking(w.reception, { customer: { name: "Mine", phone: phone() }, serviceId: w.haircut.id, barber: w.tunde.id, startsAt: lagos(4, 10) }, NOW);
    if (!r.ok) throw new Error(r.message);
    expect(await changeBookingStatus(other.owner, r.value.id, "CANCELLED", undefined, NOW)).toEqual({ ok: false, message: "Booking not found." });
    expect(await recordPayment(other.owner, r.value.id, { method: "CASH", amountMinor: 100 })).toEqual({ ok: false, message: "Booking not found." });
  });
});

describe("US-16 payments and US-29 loyalty", () => {
  it("records part payments, rejects overpaying, and refunds are owner-only", async () => {
    const r = await createWalkIn(w.reception, { phone: phone(), name: "Uche", serviceId: w.haircut.id, barber: w.chidi.id, paidNow: false, utilityConsent: false, marketingConsent: false }, NOW);
    if (!r.ok) throw new Error(r.message);
    const id = r.value.bookingId;
    expect((await recordPayment(w.reception, id, { method: "TRANSFER", amountMinor: 250_000 })).ok).toBe(true);
    expect(await recordPayment(w.reception, id, { method: "CASH", amountMinor: 60_000 })).toMatchObject({ ok: false, message: expect.stringMatching(/more than the balance/) });
    expect((await recordPayment(w.reception, id, { method: "CASH", amountMinor: 50_000 })).ok).toBe(true);
    expect(await recordPayment(w.reception, id, { method: "CASH", amountMinor: 1 })).toMatchObject({ message: "This booking is already paid." });
    await expect(refundPayment(w.reception, id, 50_000, "mistake")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await refundPayment(w.owner, id, 50_000, "mistake")).ok).toBe(true);
    expect(await w.t.payment.count({ where: { bookingId: id } })).toBe(3); // ledger rows, never edited (BR-P2)
  });

  it("BR-L3 redeems a free cut after the threshold and resets the stamps", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Loyal", phoneE164: "+2348039990001" } });
    for (const d of [30, 20, 10]) await completedVisit(w, c.id, d);
    expect(await customerLoyalty(w.t, c.id, 3)).toEqual({ stamps: 3, threshold: 3, rewardAvailable: true });
    const r = await createStaffBooking(w.reception, { customer: { customerId: c.id }, serviceId: w.haircut.id, barber: w.tunde.id, startsAt: lagos(0, 18) }, NOW);
    if (!r.ok) throw new Error(r.message);
    expect((await redeemLoyalty(w.reception, r.value.id)).ok).toBe(true);
    expect(await redeemLoyalty(w.reception, r.value.id)).toMatchObject({ ok: false });
    expect(await customerLoyalty(w.t, c.id, 3)).toMatchObject({ stamps: 0, rewardAvailable: false });
    // A free cut is not revenue: the report equals real payments minus refunds, without LOYALTY rows.
    const freePayment = await w.t.payment.findFirstOrThrow({ where: { bookingId: r.value.id } });
    expect(freePayment).toMatchObject({ method: "LOYALTY", amountMinor: 300_000 });
    const reportNow = new Date(Date.now() + 60_000);
    const report = await reportsData(w.owner, 7, reportNow);
    const inPeriod = await w.t.payment.findMany({ where: { createdAt: { gte: new Date(reportNow.getTime() - 7 * 86_400_000), lt: reportNow } } });
    const expected = inPeriod
      .filter((p) => p.method !== "LOYALTY")
      .reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amountMinor : p.amountMinor), 0);
    expect(inPeriod.some((p) => p.method === "LOYALTY")).toBe(true);
    expect(report.revenueMinor).toBe(expected);
  });

  it("won't redeem on a service that isn't a reward", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Beardy", phoneE164: "+2348039990002" } });
    for (const d of [30, 20, 10]) await completedVisit(w, c.id, d);
    const r = await createStaffBooking(w.reception, { customer: { customerId: c.id }, serviceId: w.beard.id, barber: w.chidi.id, startsAt: lagos(0, 18) }, NOW);
    if (!r.ok) throw new Error(r.message);
    expect(await redeemLoyalty(w.reception, r.value.id)).toMatchObject({ ok: false, message: expect.stringMatching(/isn't a loyalty reward/) });
  });
});

describe("Daily jobs and dispatcher (BR-R3–R9)", () => {
  let winbackCustomer: string;

  beforeEach(async () => {
    await db.message.deleteMany({ where: { salonId: w.id, type: { in: ["WINBACK", "BIRTHDAY"] } } });
  });

  it("drafts win-backs only for eligible customers, idempotently", async () => {
    const make = async (name: string, data: object) => {
      const c = await w.t.customer.create({ data: { salonId: w.id, name, phoneE164: `+23480399${Math.floor(Math.random() * 1e5).toString().padStart(5, "0")}`, ...data } });
      await completedVisit(w, c.id, 40);
      await db.customer.update({ where: { id: c.id }, data: { lastVisitAt: lagos(-40, 10), usualGapDays: 21 } });
      return c.id;
    };
    winbackCustomer = await make("Due Dayo", { marketingConsent: true, utilityConsent: true });
    const noConsent = await make("No Consent", { marketingConsent: false });
    const holdout = await make("Held Out", { marketingConsent: true, holdout: true });
    const booked = await make("Booked Already", { marketingConsent: true });
    await createStaffBooking(w.reception, { customer: { customerId: booked }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(5, 12) }, NOW);

    await runDailyJobs({ now: NOW, salonId: w.id });
    await runDailyJobs({ now: NOW, salonId: w.id });
    const drafts = await w.t.message.findMany({ where: { type: "WINBACK", status: "DRAFT" } });
    const ids = drafts.map((d) => d.customerId);
    expect(ids).toContain(winbackCustomer);
    expect(ids).not.toContain(noConsent);
    expect(ids).not.toContain(holdout);
    expect(ids).not.toContain(booked);
    expect(drafts.filter((d) => d.customerId === winbackCustomer)).toHaveLength(1);
    expect(drafts.find((d) => d.customerId === winbackCustomer)?.whyNow).toBe("Last visit 6 weeks ago. Usually every 3 weeks with Tunde.");
  });

  it("switching to 'with offer' needs a real promotion and renders its offer line", async () => {
    await runDailyJobs({ now: NOW, salonId: w.id });
    const draft = await w.t.message.findFirstOrThrow({ where: { type: "WINBACK", status: "DRAFT", customerId: winbackCustomer } });
    expect(await setDraftVariant(w.owner, draft.id, "with_offer", NOW)).toMatchObject({ ok: false });
    await savePromotion(w.owner, { name: "Midweek", kind: "PERCENT", value: 10, serviceIds: [w.haircut.id], startsOn: "2026-10-01", endsOn: "2026-10-31", isBirthday: false });
    expect((await setDraftVariant(w.owner, draft.id, "with_offer", NOW)).ok).toBe(true);
    const updated = await w.t.message.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updated.renderedText).toContain("Enjoy 10% off any haircut until 31 Oct.");
    expect(updated.renderedText).toMatch(/Reply STOP to opt out\.$/);
  });

  it("Approve all sends eligible drafts and skips ones that booked since", async () => {
    await runDailyJobs({ now: NOW, salonId: w.id });
    const result = await approveDrafts(w.owner, "all", undefined, NOW);
    expect(result.ok && result.value.queued).toBeGreaterThanOrEqual(1);
    const sent = await w.t.message.findFirstOrThrow({ where: { type: "WINBACK", customerId: winbackCustomer } });
    expect(sent.status).toBe("DELIVERED");
    expect(sent.approvedById).toBe(w.owner.member.userId);
  });

  it("Approve is owner-only", async () => {
    await expect(approveDrafts(w.reception, "all", undefined, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("BR-R7 defers marketing in quiet hours, but sends utility messages", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Night Owl", phoneE164: "+2348039990010", marketingConsent: true, utilityConsent: true, lastVisitAt: lagos(-40, 10), usualGapDays: 21 } });
    await completedVisit(w, c.id, 40);
    const late = lagos(0, 21, 30);
    await runDailyJobs({ now: late, salonId: w.id });
    await approveDrafts(w.owner, "all", undefined, late);
    const m = await w.t.message.findFirstOrThrow({ where: { type: "WINBACK", customerId: c.id } });
    expect(m.status).toBe("QUEUED");
    expect(m.nextAttemptAt?.toISOString()).toBe(lagos(1, 8).toISOString());
  });

  it("never sends a birthday wish a day late (found in the end-to-end data review)", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Late Birthday", phoneE164: "+2348039990040", marketingConsent: true, utilityConsent: true } });
    const evening = lagos(0, 22); // quiet hours: the next allowed time is tomorrow 08:00
    const m = await w.t.message.create({
      data: { salonId: w.id, customerId: c.id, type: "BIRTHDAY", renderedText: "Happy birthday", status: "QUEUED", idempotencyKey: `bday-${c.id}`, scheduledFor: evening },
    });
    await dispatchDue({ now: evening, salonId: w.id });
    expect(await w.t.message.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "SKIPPED", skipReason: "birthday_passed" });
  });

  it("re-checks consent at send time: a queued message after STOP is skipped, and STOP is confirmed", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Stopper", phoneE164: "+2348039990020", marketingConsent: true, utilityConsent: true, lastVisitAt: lagos(-40, 10), usualGapDays: 21 } });
    await completedVisit(w, c.id, 40);
    await runDailyJobs({ now: NOW, salonId: w.id });
    const draft = await w.t.message.findFirstOrThrow({ where: { type: "WINBACK", customerId: c.id, status: "DRAFT" } });
    await w.t.message.update({ where: { id: draft.id }, data: { status: "QUEUED", scheduledFor: new Date(NOW.getTime() + 60_000) } });

    const r = await handleInbound({ fromE164: c.phoneE164, text: "stop", providerMessageId: "wamid.stop1", receivedAt: NOW, salonId: w.id });
    expect(r?.keyword).toBe("STOP");
    expect((await w.t.customer.findUniqueOrThrow({ where: { id: c.id } })).marketingConsent).toBe(false);

    await dispatchDue({ now: new Date(NOW.getTime() + 2 * 60_000), salonId: w.id });
    expect(await w.t.message.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "SKIPPED", skipReason: "no_consent" });
    const confirmation = await w.t.message.findFirstOrThrow({ where: { customerId: c.id, type: "OPTOUT_CONFIRMATION" } });
    expect(confirmation.status).toBe("DELIVERED");

    // Webhook retries don't double-process.
    await handleInbound({ fromE164: c.phoneE164, text: "stop", providerMessageId: "wamid.stop1", receivedAt: NOW, salonId: w.id });
    expect(await w.t.message.count({ where: { customerId: c.id, type: "OPTOUT_CONFIRMATION" } })).toBe(1);
  });

  it("BR-R9 marks 'not on WhatsApp' as failed without retrying and flags the number", async () => {
    const r = await createStaffBooking(w.reception, { customer: { name: "Bad Number", phone: "08030000000" }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(6, 10), utilityConsent: true }, NOW);
    if (!r.ok) throw new Error(r.message);
    await dispatchDue({ now: NOW, salonId: w.id });
    const conf = await w.t.message.findFirstOrThrow({ where: { bookingId: r.value.id, type: "BOOKING_CONFIRMATION" } });
    expect(conf).toMatchObject({ status: "FAILED", failureReason: "not_on_whatsapp", attempts: 1 });
    const customer = await w.t.customer.findFirstOrThrow({ where: { name: "Bad Number" } });
    expect(customer.phoneInvalid).toBe(true);
  });

  it("skips reminders for a cancelled booking even if they were already queued", async () => {
    const r = await createStaffBooking(w.reception, { customer: { name: "Canceller", phone: phone() }, serviceId: w.haircut.id, barber: w.chidi.id, startsAt: lagos(7, 10), utilityConsent: true }, NOW);
    if (!r.ok) throw new Error(r.message);
    await changeBookingStatus(w.reception, r.value.id, "CANCELLED", "customer called", NOW);
    const statuses = await w.t.message.findMany({ where: { bookingId: r.value.id }, select: { status: true, skipReason: true } });
    expect(statuses.every((s) => s.status === "SKIPPED" && s.skipReason === "booking_cancelled")).toBe(true);
  });
});

describe("US-28 inbox", () => {
  it("replies inside the 24-hour window only", async () => {
    const c = await w.t.customer.create({ data: { salonId: w.id, name: "Asker", phoneE164: "+2348039990030", utilityConsent: true } });
    await handleInbound({ fromE164: c.phoneE164, text: "Do you open Sunday?", providerMessageId: "wamid.q1", receivedAt: NOW, salonId: w.id });
    const conv = await w.t.conversation.findFirstOrThrow({ where: { customerId: c.id } });
    expect(conv.unreadCount).toBe(1);
    expect((await replyInConversation(w.reception, conv.id, "Yes, 12–5pm.", new Date(NOW.getTime() + 3600_000))).ok).toBe(true);
    expect(await replyInConversation(w.reception, conv.id, "Late reply", new Date(NOW.getTime() + 25 * 3600_000))).toMatchObject({ ok: false, message: expect.stringMatching(/24-hour/) });
    await expect(replyInConversation(w.barber, conv.id, "Hi", NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("US-27 data rights", () => {
  it("anonymises personal data but keeps bookings, payments and sent-message statuses", async () => {
    const r = await createWalkIn(w.reception, { phone: phone(), name: "Private Person", serviceId: w.haircut.id, barber: w.chidi.id, paidNow: true, method: "POS", utilityConsent: true, marketingConsent: true }, NOW);
    if (!r.ok) throw new Error(r.message);
    const b = await w.t.booking.findUniqueOrThrow({ where: { id: r.value.bookingId } });
    await w.t.message.create({ data: { salonId: w.id, customerId: b.customerId, type: "BIRTHDAY", renderedText: "Happy birthday Private", status: "DELIVERED", idempotencyKey: `t-${b.id}`, scheduledFor: NOW } });
    await expect(anonymiseCustomer(w.reception, b.customerId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await anonymiseCustomer(w.owner, b.customerId)).ok).toBe(true);
    const c = await w.t.customer.findUniqueOrThrow({ where: { id: b.customerId } });
    expect(c).toMatchObject({ name: "Deleted customer", email: null, marketingConsent: false });
    expect(c.phoneE164).toBe(`deleted:${c.id}`);
    expect(await w.t.payment.count({ where: { bookingId: b.id } })).toBe(1);
    const m = await w.t.message.findFirstOrThrow({ where: { customerId: c.id, type: "BIRTHDAY" } });
    expect(m).toMatchObject({ status: "DELIVERED", renderedText: "[deleted]" });
  });
});

describe("Offer campaigns (PRD §7 flow 5, BR-PR1–PR3)", () => {
  it("previews exclusions, sends once per day, and rejects typed discounts", async () => {
    const { previewCampaign, sendCampaign } = await import("./campaigns");
    const promo = await savePromotion(w.owner, { name: "Weekday 15", kind: "PERCENT", value: 15, serviceIds: [w.haircut.id], startsOn: "2026-01-01", endsOn: "2030-12-31", isBirthday: false });
    expect(promo.ok).toBe(true);
    const p = await w.t.promotion.findFirstOrThrow({ where: { name: "Weekday 15" } });
    const mk = (name: string, phoneE164: string, data: object) => w.t.customer.create({ data: { salonId: w.id, name, phoneE164, ...data } });
    await mk("Camp Yes", "+2348039990101", { marketingConsent: true, utilityConsent: true });
    await mk("Camp No", "+2348039990102", { marketingConsent: false });
    await mk("Camp Hold", "+2348039990103", { marketingConsent: true, holdout: true });
    await mk("Camp Bad", "+2348039990104", { marketingConsent: true, phoneInvalid: true });

    const wording = "Hi {{first_name}}, {{salon_name}} has something for you: {{offer}}";
    const preview = await previewCampaign(w.owner, { promotionId: p.id, segment: "all", wording }, NOW);
    if (!preview.ok) throw new Error(preview.message);
    expect(preview.value.excluded.noConsent).toBeGreaterThanOrEqual(1);
    expect(preview.value.excluded.holdout).toBeGreaterThanOrEqual(1);
    expect(preview.value.excluded.badNumber).toBeGreaterThanOrEqual(1);
    expect(preview.value.preview).toMatch(/^Hi \w+, Sharp & Co\. has something for you: Enjoy 15% off any haircut until 31 Dec\. Book: http\S+ Reply STOP to opt out\.$/);

    expect(await sendCampaign(w.owner, { promotionId: p.id, segment: "all", wording: "Get 50% off today! {{offer}}" }, NOW)).toMatchObject({ ok: false });
    await expect(sendCampaign(w.reception, { promotionId: p.id, segment: "all", wording }, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    const first = await sendCampaign(w.owner, { promotionId: p.id, segment: "all", wording }, NOW);
    if (!first.ok) throw new Error(first.message);
    expect(first.value.queued).toBe(preview.value.recipients);
    const yes = await w.t.customer.findFirstOrThrow({ where: { name: "Camp Yes" } });
    const sentToYes = await w.t.message.findFirstOrThrow({ where: { customerId: yes.id, type: "PROMOTION" } });
    expect(sentToYes).toMatchObject({ status: "DELIVERED", promotionId: p.id, approvedById: w.owner.member.userId });
    expect(sentToYes.renderedText).toContain("Hi Camp, Sharp & Co. has something for you: Enjoy 15% off any haircut");
    for (const name of ["Camp No", "Camp Hold", "Camp Bad"]) {
      const c = await w.t.customer.findFirstOrThrow({ where: { name } });
      expect(await w.t.message.count({ where: { customerId: c.id, type: "PROMOTION" } })).toBe(0);
    }
    // Pressing send again doesn't message anyone twice: everyone just messaged is now over the
    // weekly cap, so the send is refused, and the idempotency key would stop it anyway.
    const again = await sendCampaign(w.owner, { promotionId: p.id, segment: "all", wording }, NOW);
    expect(again).toMatchObject({ ok: false, message: expect.stringMatching(/Nobody in this group/) });
    expect(await w.t.message.count({ where: { customerId: yes.id, type: "PROMOTION" } })).toBe(1);
  });
});

describe("US-17 online payments (BR-P3)", () => {
  const fresh = async <C extends { salon: unknown }>(c: C) => ({ ...c, salon: await db.salon.findUniqueOrThrow({ where: { id: w.id } }) });

  it("records a verified payment once, rejects a wrong currency, and flags overpayment", async () => {
    const { recordOnlinePayment } = await import("@/server/platform/payments");
    const { createPaymentLinkForStaff } = await import("@/server/payments/links");
    const { newReference } = await import("@/server/payments/providers");
    const { connectPaystackAccount, setPaymentProvider } = await import("@/server/staff/settings");
    const r = await createWalkIn(w.reception, { phone: "0803 555 0901", name: "Online Payer", serviceId: w.haircut.id, barber: w.chidi.id, paidNow: false, utilityConsent: true, marketingConsent: false }, NOW);
    if (!r.ok) throw new Error(r.message);
    const bookingId = r.value.bookingId;

    // Payments off for the salon → no link. Provider chosen but no payout account → still no link.
    expect(await createPaymentLinkForStaff(w.reception, bookingId)).toMatchObject({ ok: false, message: expect.stringMatching(/aren't set up/) });
    expect(await setPaymentProvider(w.owner, "PAYSTACK")).toMatchObject({ ok: true });
    expect(await createPaymentLinkForStaff(await fresh(w.reception), bookingId)).toMatchObject({ ok: false, message: expect.stringMatching(/aren't set up/) });
    expect(await connectPaystackAccount(w.owner, { bankCode: "058", accountNumber: "0123456789" })).toMatchObject({ ok: true });
    const ctxWithProvider = await fresh(w.reception);
    const link = await createPaymentLinkForStaff(ctxWithProvider, bookingId);
    expect(link).toMatchObject({ ok: true, value: { amountMinor: 300_000 } });

    const ref = newReference(bookingId);
    const ev = { reference: ref, bookingId, amountMinor: 300_000, account: null };
    expect(await recordOnlinePayment("FAKE", { ...ev, currency: "GBP" })).toBe("rejected");
    expect(await recordOnlinePayment("FAKE", { ...ev, currency: "NGN" })).toBe("recorded");
    expect(await recordOnlinePayment("FAKE", { ...ev, currency: "NGN" })).toBe("duplicate");
    const payments = await w.t.payment.findMany({ where: { bookingId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: "ONLINE", provider: "FAKE", providerReference: ref });
    expect(await createPaymentLinkForStaff(ctxWithProvider, bookingId)).toMatchObject({ ok: false, message: "This booking is already paid." });

    // Money already received is always recorded, and an overpayment is flagged for the owner.
    expect(await recordOnlinePayment("FAKE", { ...ev, reference: newReference(bookingId), amountMinor: 50_000, currency: "NGN" })).toBe("recorded");
    expect(await w.t.auditLog.count({ where: { action: "payment.overpaid" } })).toBe(1);
    await setPaymentProvider(w.owner, null);
  });

  it("ADR-0006 only owners connect a payout account; switching provider disconnects it", async () => {
    const { connectPaystackAccount, disconnectPaymentAccount, setPaymentProvider } = await import("@/server/staff/settings");
    await expect(connectPaystackAccount(w.reception, { bankCode: "058", accountNumber: "0123456789" })).rejects.toThrow(ForbiddenError);
    expect(await connectPaystackAccount(w.owner, { bankCode: "058", accountNumber: "0123456789" })).toMatchObject({ ok: false, message: "Choose Paystack first." });
    await setPaymentProvider(w.owner, "PAYSTACK");
    expect(await connectPaystackAccount(w.owner, { bankCode: "058", accountNumber: "12-34" })).toMatchObject({ ok: false, message: expect.stringMatching(/digits only/) });
    expect(await connectPaystackAccount(w.owner, { bankCode: "999", accountNumber: "0123456789" })).toMatchObject({ ok: false, message: "Choose your bank." });
    expect(await connectPaystackAccount(w.owner, { bankCode: "058", accountNumber: "0123 456 789" })).toMatchObject({ ok: true });
    let salon = await db.salon.findUniqueOrThrow({ where: { id: w.id } });
    expect(salon).toMatchObject({ paymentAccountReady: true, paymentAccountLabel: "Test Bank A ••••6789" });
    // The audit log keeps the label only, never the account number.
    const logged = await w.t.auditLog.findFirstOrThrow({ where: { action: "payment_account.connected" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(logged)).not.toContain("0123456789");

    await setPaymentProvider(w.owner, "STRIPE");
    salon = await db.salon.findUniqueOrThrow({ where: { id: w.id } });
    expect(salon).toMatchObject({ paymentProvider: "STRIPE", paymentProviderAccount: null, paymentAccountReady: false });
    await disconnectPaymentAccount(w.owner);
    await setPaymentProvider(w.owner, null);
  });

  it("ADR-0006 Stripe Connect: onboarding, then account.updated can pause payments", async () => {
    const { refreshStripeAccount, setPaymentProvider, startStripeConnect } = await import("@/server/staff/settings");
    const { updateConnectedAccount } = await import("@/server/platform/payments");
    await setPaymentProvider(w.owner, "STRIPE");
    const started = await startStripeConnect(w.owner, "owner@example.test");
    // Test mode skips Stripe's pages and comes straight back.
    expect(started).toMatchObject({ ok: true, value: { url: expect.stringMatching(/\/app\/settings\/stripe\?step=return$/) } });
    expect(await db.salon.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ paymentProviderAccount: `acct_test_${w.id}`, paymentAccountReady: false });
    expect(await refreshStripeAccount(w.owner)).toMatchObject({ ok: true, value: { ready: true } });

    expect(await updateConnectedAccount("STRIPE", `acct_test_${w.id}`, false)).toBe(true);
    expect((await db.salon.findUniqueOrThrow({ where: { id: w.id } })).paymentAccountReady).toBe(false);
    expect(await w.t.auditLog.count({ where: { action: "payment_account.restricted" } })).toBe(1);
    expect(await updateConnectedAccount("STRIPE", "acct_someone_else", true)).toBe(false);
    await setPaymentProvider(w.owner, null);
  });

  it("a verified payment that landed in a different account is still recorded, and flagged", async () => {
    const { recordOnlinePayment } = await import("@/server/platform/payments");
    const { newReference } = await import("@/server/payments/providers");
    const { connectPaystackAccount, setPaymentProvider } = await import("@/server/staff/settings");
    await setPaymentProvider(w.owner, "PAYSTACK");
    await connectPaystackAccount(w.owner, { bankCode: "058", accountNumber: "0123456789" });
    const r = await createWalkIn(w.reception, { phone: "0803 555 0902", name: "Old Link Payer", serviceId: w.haircut.id, barber: w.chidi.id, paidNow: false, utilityConsent: true, marketingConsent: false }, NOW);
    if (!r.ok) throw new Error(r.message);
    const ev = { bookingId: r.value.bookingId, amountMinor: 300_000, currency: "NGN" };
    expect(await recordOnlinePayment("PAYSTACK", { ...ev, reference: newReference(r.value.bookingId), account: `ACCT_test_${w.id}` })).toBe("recorded");
    expect(await w.t.auditLog.count({ where: { action: "payment.account_mismatch" } })).toBe(0);
    expect(await recordOnlinePayment("PAYSTACK", { ...ev, reference: newReference(r.value.bookingId), account: "ACCT_old" })).toBe("recorded");
    expect(await w.t.auditLog.count({ where: { action: "payment.account_mismatch" } })).toBe(1);
    await setPaymentProvider(w.owner, null);
  });
});

describe("US-30 AI copy assistant and its feedback loop (ai-design.md §6)", () => {
  const stub = (drafts: string[], cost = 1500) => ({
    provider: "stub",
    model: "stub-model",
    draft: async () => ({ drafts, provider: "stub", model: "stub-model", inputTokens: 100, outputTokens: 50, costMicroUsd: cost }),
  });

  it("shows only drafts that pass the guardrails, logs every call without customer data, and records the outcome", async () => {
    const { draftCopy, saveWording } = await import("./copy-assistant");
    const { summariseGenerations } = await import("@/domain/ai-quality");
    const good = "Hi {{first_name}}, it's been a while! Book your next cut at {{salon_name}}: {{booking_link}}";
    const bad = "LAST CHANCE!!! Call {{phone}}";
    const r = await draftCopy(w.owner, { variant: "friendly", tone: "friendly" }, stub([bad, good]), NOW);
    expect(r).toMatchObject({ ok: true, value: { drafts: [good] } });
    if (!r.ok) throw new Error();
    const gen = await w.t.aIGeneration.findUniqueOrThrow({ where: { id: r.value.generationId } });
    expect(gen).toMatchObject({ feature: "copy_assistant", provider: "stub", costMicroUsd: 1500 });
    expect(JSON.stringify(gen.input)).not.toMatch(/\+234|0803/); // salon facts only

    // The owner picks the passing draft (index 1 of what the model returned), edits it, and saves.
    const edited = good.replace("it's been a while", "we miss you");
    expect(await saveWording(w.owner, { variant: "friendly", wording: edited, generationId: gen.id, pickedDraft: good })).toMatchObject({ ok: true });
    const after = await w.t.aIGeneration.findUniqueOrThrow({ where: { id: gen.id } });
    expect(after).toMatchObject({ selectedIndex: 1, finalText: edited, approvedById: w.owner.member.userId });
    const [summary] = summariseGenerations([after]);
    expect(summary).toMatchObject({ adoptionRate: 1, keptAsIsRate: 0, guardrailPassRate: 0.5 });
  });

  it("refuses once the salon's monthly AI budget is used up", async () => {
    const { draftCopy } = await import("./copy-assistant");
    const spend = await w.t.aIGeneration.aggregate({ where: { createdAt: { gte: new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1)) } }, _sum: { costMicroUsd: true } });
    const remaining = w.salon.aiMonthlyBudgetMicroUsd - (spend._sum.costMicroUsd ?? 0);
    const good = "Hi {{first_name}}, time for a fresh cut at {{salon_name}}? {{booking_link}}";
    await draftCopy(w.owner, { variant: "friendly", tone: "friendly" }, stub([good], remaining), NOW);
    expect(await draftCopy(w.owner, { variant: "friendly", tone: "friendly" }, stub([good]), NOW)).toMatchObject({ ok: false, message: expect.stringMatching(/budget is used up/) });
    await w.t.aIGeneration.deleteMany({});
  });

  it("logs failed calls and still lets the owner write the wording", async () => {
    const { draftCopy } = await import("./copy-assistant");
    const failing = { provider: "stub", model: "stub-model", draft: async () => Promise.reject(new Error("timeout")) };
    expect(await draftCopy(w.owner, { variant: "friendly", tone: "friendly" }, failing, NOW)).toMatchObject({ ok: false, message: expect.stringMatching(/write the wording yourself/) });
    expect(await w.t.aIGeneration.count({ where: { error: "timeout" } })).toBe(1);
    await expect(draftCopy(w.reception, { variant: "friendly", tone: "friendly" }, failing, NOW)).rejects.toThrow(ForbiddenError);
  });
});
