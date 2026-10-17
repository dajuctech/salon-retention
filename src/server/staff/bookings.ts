// Staff booking operations (US-09, US-12, US-13, BR-B*, BR-A6).
import { checkTransition, type BookingStatus } from "@/domain/booking-status";
import { STAFF_MARKETING_WORDING, STAFF_UTILITY_WORDING } from "@/domain/consent-wording";
import { usualGapDays } from "@/domain/messaging-rules";
import { normalizePhone } from "@/domain/phone";
import { audit, type DbLike } from "@/server/audit";
import { ForbiddenError, assertCan } from "@/server/authz";
import { ANY_BARBER, SLOT_TAKEN_MESSAGE, assignBarber, nextRef, saveBooking } from "@/server/bookings-core";
import { setConsent } from "@/server/consent";
import { findOrCreateCustomer } from "@/server/customers";
import { forSalon } from "@/server/db";
import { planBookingMessages, skipPendingForBooking, skipPendingWinback } from "@/server/messaging/queue";
import { STAFF_RULES } from "@/server/slots";
import { fail, ok, staffAudit, type StaffCtx } from "./context";
import { recordPaymentTx } from "./payments";

const DEFAULT_GAP_DAYS = 21;
/** Staff see why: the time may be taken, outside working hours or off the slot grid. */
const STAFF_SLOT_MESSAGE = "That time isn't free for that barber (taken, outside their hours, or not on the slot grid).";

/** BR-B5 / BR-R3a: visit count, last visit and usual gap, recomputed from completed bookings. */
export async function recomputeCustomerStats(db: DbLike, customerId: string): Promise<void> {
  const completed = await db.booking.findMany({
    where: { customerId, status: "COMPLETED" },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true, service: { select: { returnReminderDays: true } } },
  });
  const fallback = completed.at(-1)?.service.returnReminderDays ?? DEFAULT_GAP_DAYS;
  await db.customer.update({
    where: { id: customerId },
    data: {
      visitCount: completed.length,
      lastVisitAt: completed.at(-1)?.startsAt ?? null,
      usualGapDays: completed.length ? usualGapDays(completed.map((c) => c.startsAt), fallback) : null,
    },
  });
}

function capabilityFor(to: BookingStatus, correction: boolean) {
  if (correction) return "bookings.correct" as const;
  return to === "CONFIRMED" || to === "CANCELLED" ? ("bookings.manage" as const) : ("bookings.complete" as const);
}

export async function changeBookingStatus(
  ctx: StaffCtx,
  bookingId: string,
  to: BookingStatus,
  reason?: string,
  now = new Date(),
) {
  const db = forSalon(ctx.member.salonId);
  const booking = await db.booking.findFirst({ where: { id: bookingId } });
  if (!booking) return fail("Booking not found.");
  const check = checkTransition(booking.status, to, {
    now,
    startsAt: booking.startsAt,
    noShowGraceMinutes: ctx.salon.noShowGraceMinutes,
    isOwner: ctx.member.role === "owner",
  });
  if (!check.ok) {
    return fail(
      check.reason === "too_early_for_no_show"
        ? `You can mark a no-show ${ctx.salon.noShowGraceMinutes} minutes after the start time.`
        : check.reason === "owner_only"
          ? "Only the owner can undo this."
          : "That change isn't allowed for this booking.",
    );
  }
  assertCan(ctx.member, capabilityFor(to, check.correction), booking.barberId);

  await db.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: to, ...(to === "CANCELLED" ? { cancelReason: reason ?? "staff" } : {}) },
    });
    if (to === "COMPLETED" || booking.status === "COMPLETED") await recomputeCustomerStats(tx, booking.customerId);
    if (to === "COMPLETED") await skipPendingWinback(tx, booking.customerId, "visited");
    if (to === "CANCELLED" || to === "NO_SHOW" || to === "COMPLETED" || to === "IN_PROGRESS") {
      await skipPendingForBooking(tx, booking.id, to === "CANCELLED" ? "booking_cancelled" : "booking_changed");
    }
    await audit(tx, {
      ...staffAudit(ctx),
      action: check.correction ? "booking.status_corrected" : "booking.status_changed",
      entityType: "Booking",
      entityId: booking.id,
      before: { status: booking.status },
      after: { status: to, ...(reason ? { reason } : {}) },
    });
  });
  return ok;
}

type CustomerChoice = { customerId: string } | { name: string; phone: string };

export type StaffBookingInput = {
  customer: CustomerChoice;
  serviceId: string;
  barber: string; // barber id or "any"
  startsAt: Date;
  notes?: string;
  utilityConsent?: boolean;
  marketingConsent?: boolean;
};

async function resolveCustomer(ctx: StaffCtx, tx: DbLike, choice: CustomerChoice) {
  if ("customerId" in choice) {
    const c = await tx.customer.findFirst({ where: { id: choice.customerId, anonymisedAt: null } });
    if (!c) throw new UserError("Customer not found.");
    return c;
  }
  const phone = normalizePhone(choice.phone, ctx.salon.countryCode);
  if (!phone.ok) throw new UserError("That phone number isn't valid.");
  if (choice.name.trim().length < 2) throw new UserError("Enter the customer's name.");
  return (await findOrCreateCustomer(tx, ctx.member.salonId, { name: choice.name, phoneE164: phone.e164 })).customer;
}

class UserError extends Error {}

async function recordStaffConsent(ctx: StaffCtx, tx: DbLike, customerId: string, utility?: boolean, marketing?: boolean) {
  const base = { salonId: ctx.member.salonId, customerId, granted: true, source: "STAFF_VERBAL" as const, actorId: ctx.member.userId };
  if (utility) await setConsent(tx, { ...base, purpose: "UTILITY", wording: STAFF_UTILITY_WORDING });
  if (marketing) await setConsent(tx, { ...base, purpose: "MARKETING", wording: STAFF_MARKETING_WORDING });
}

/** US-12: staff create a booking (staff slot rules: can book now, up to 90 days ahead). */
export async function createStaffBooking(ctx: StaffCtx, input: StaffBookingInput, now = new Date()) {
  const db = forSalon(ctx.member.salonId);
  // Barbers may only book themselves.
  const barberChoice = ctx.member.role === "barber" ? (ctx.member.barberId ?? "none") : input.barber;
  assertCan(ctx.member, "bookings.manage", barberChoice === ANY_BARBER ? null : barberChoice);
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) return fail("Choose a service.");
  const barber = await assignBarberStaff(ctx, service, barberChoice, input.startsAt, now);
  if (!barber) return fail(SLOT_TAKEN_MESSAGE);

  try {
    const saved = await saveBooking(db, async (tx, attempt) => {
      const customer = await resolveCustomer(ctx, tx, input.customer);
      await recordStaffConsent(ctx, tx, customer.id, input.utilityConsent, input.marketingConsent);
      const booking = await tx.booking.create({
        data: {
          salonId: ctx.member.salonId,
          ref: await nextRef(tx, ctx.salon.name, attempt),
          customerId: customer.id,
          barberId: barber.id,
          serviceId: service.id,
          startsAt: input.startsAt,
          endsAt: new Date(input.startsAt.getTime() + (service.durationMin + service.bufferMin) * 60_000),
          status: "CONFIRMED",
          source: "STAFF",
          priceMinor: service.priceMinor,
          currency: service.currency,
          notes: input.notes?.trim() || null,
          createdById: ctx.member.userId,
        },
      });
      await planBookingMessages(tx, ctx.salon, { ...booking, customer, service, barber }, now, { confirmation: true });
      await skipPendingWinback(tx, customer.id, "booked_since");
      await audit(tx, { ...staffAudit(ctx), action: "booking.created", entityType: "Booking", entityId: booking.id });
      return booking;
    });
    return saved.ok ? { ok: true as const, value: saved.value } : fail(SLOT_TAKEN_MESSAGE);
  } catch (err) {
    if (err instanceof UserError) return fail(err.message);
    throw err;
  }
}

function assignBarberStaff(
  ctx: StaffCtx,
  service: { durationMin: number; bufferMin: number },
  barberChoice: string,
  startsAt: Date,
  now: Date,
  ignoreBookingId?: string,
) {
  const db = forSalon(ctx.member.salonId);
  const salon = { ...ctx.salon, minLeadMinutes: STAFF_RULES.minLeadMin, maxAdvanceDays: STAFF_RULES.maxAdvanceDays };
  // Staff can book any time on the grid, including slightly in the past for "now".
  return assignBarber(db, salon, service, barberChoice, startsAt, new Date(now.getTime() - 30 * 60_000), ignoreBookingId);
}

export type WalkInInput = {
  /** An existing customer picked from the lookup; otherwise phone (+ name if new). */
  customerId?: string;
  phone: string;
  name?: string;
  serviceId: string;
  barber: string;
  paidNow: boolean;
  method?: "CASH" | "TRANSFER" | "POS" | "CARD";
  utilityConsent: boolean;
  marketingConsent: boolean;
};

/**
 * US-09 / BR-A6: a walk-in starts now and goes straight "in chair". It may overlap another booking
 * (the customer is physically here); staff get a warning instead of a block.
 */
export async function createWalkIn(ctx: StaffCtx, input: WalkInInput, now = new Date()) {
  const db = forSalon(ctx.member.salonId);
  const phone = input.customerId ? null : normalizePhone(input.phone, ctx.salon.countryCode);
  if (phone && !phone.ok) return fail("That phone number isn't valid.");
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) return fail("Choose a service.");

  let barberId = ctx.member.role === "barber" ? ctx.member.barberId : input.barber;
  if (!barberId) return fail("Choose a barber.");
  if (barberId === ANY_BARBER) {
    const free = await assignBarberStaff(ctx, service, ANY_BARBER, floorToGrid(now, ctx.salon.slotGridMinutes), now);
    barberId = free?.id ?? (await db.barber.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } }))?.id ?? null;
    if (!barberId) return fail("Add a barber in Settings first.");
  }
  assertCan(ctx.member, "bookings.manage", barberId);
  const barber = await db.barber.findFirst({ where: { id: barberId, active: true } });
  if (!barber) return fail("Choose a barber.");

  const startsAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const endsAt = new Date(startsAt.getTime() + (service.durationMin + service.bufferMin) * 60_000);
  const overlap = await db.booking.findFirst({
    where: { barberId, status: { in: ["CONFIRMED", "IN_PROGRESS", "PENDING"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    include: { customer: { select: { name: true } } },
  });

  const saved = await saveBooking(db, async (tx, attempt) => {
    const existing = input.customerId
      ? await tx.customer.findFirst({ where: { id: input.customerId, anonymisedAt: null } })
      : await tx.customer.findFirst({ where: { phoneE164: phone!.ok ? phone!.e164 : "" } });
    if (input.customerId && !existing) throw new UserError("Customer not found.");
    if (!existing && (!input.name || input.name.trim().length < 2)) throw new UserError("Enter the customer's name.");
    const customer =
      existing ?? (await findOrCreateCustomer(tx, ctx.member.salonId, { name: input.name!, phoneE164: phone!.ok ? phone!.e164 : "" })).customer;
    await recordStaffConsent(ctx, tx, customer.id, input.utilityConsent, input.marketingConsent);
    const booking = await tx.booking.create({
      data: {
        salonId: ctx.member.salonId,
        ref: await nextRef(tx, ctx.salon.name, attempt),
        customerId: customer.id,
        barberId,
        serviceId: service.id,
        startsAt,
        endsAt,
        status: "IN_PROGRESS",
        source: "WALK_IN",
        priceMinor: service.priceMinor,
        currency: service.currency,
        createdById: ctx.member.userId,
      },
    });
    if (input.paidNow) {
      await recordPaymentTx(ctx, tx, booking, { method: input.method ?? "CASH", amountMinor: service.priceMinor });
    }
    await skipPendingWinback(tx, customer.id, "visited");
    await audit(tx, { ...staffAudit(ctx), action: "booking.walk_in", entityType: "Booking", entityId: booking.id });
    return { booking, customer };
  }).catch((err) => {
    if (err instanceof UserError) return { ok: false as const, userError: err.message };
    throw err;
  });
  if ("userError" in saved) return fail(saved.userError);
  if (!saved.ok) return fail("Couldn't save the walk-in. Please try again.");
  return {
    ok: true as const,
    value: {
      bookingId: saved.value.booking.id,
      customerName: saved.value.customer.name,
      barberName: barber.displayName,
      warning: overlap ? `${barber.displayName} also has ${overlap.customer.name} booked at this time.` : null,
    },
  };
}

function floorToGrid(d: Date, gridMin: number): Date {
  const step = gridMin * 60_000;
  return new Date(Math.floor(d.getTime() / step) * step);
}

/** US-12 / BR-B6: move a booking; pending reminders are replaced. */
export async function rescheduleBookingStaff(
  ctx: StaffCtx,
  bookingId: string,
  startsAt: Date,
  barberChoice: string,
  now = new Date(),
) {
  const db = forSalon(ctx.member.salonId);
  const booking = await db.booking.findFirst({ where: { id: bookingId }, include: { service: true } });
  if (!booking) return fail("Booking not found.");
  if (booking.status !== "CONFIRMED" && booking.status !== "PENDING") return fail("Only upcoming bookings can be moved.");
  assertCan(ctx.member, "bookings.manage", booking.barberId);
  const choice = ctx.member.role === "barber" ? (ctx.member.barberId ?? "none") : barberChoice;
  const barber = await assignBarberStaff(ctx, booking.service, choice, startsAt, now, booking.id);
  if (!barber) return fail(STAFF_SLOT_MESSAGE);
  const endsAt = new Date(startsAt.getTime() + (booking.service.durationMin + booking.service.bufferMin) * 60_000);
  const saved = await saveBooking(db, async (tx) => {
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { startsAt, endsAt, barberId: barber.id },
      include: { customer: true, service: true, barber: true },
    });
    await skipPendingForBooking(tx, booking.id, "rescheduled");
    await planBookingMessages(tx, ctx.salon, updated, now, { confirmation: true });
    await audit(tx, {
      ...staffAudit(ctx),
      action: "booking.rescheduled",
      entityType: "Booking",
      entityId: booking.id,
      before: { startsAt: booking.startsAt.toISOString(), barberId: booking.barberId },
      after: { startsAt: startsAt.toISOString(), barberId: barber.id },
    });
    return updated;
  });
  return saved.ok ? ok : fail(STAFF_SLOT_MESSAGE);
}

export { ForbiddenError };
