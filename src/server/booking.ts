// Public online booking (US-10, US-11, US-18). Domain rules decide; the database constraint is the last guard.
import { onlinePaymentsReady } from "@/server/payments/providers";
import { z } from "zod";
import { MARKETING_CONSENT_WORDING, UTILITY_CONSENT_WORDING } from "@/domain/consent-wording";
import { checkTransition } from "@/domain/booking-status";
import { COUNTRIES } from "@/domain/countries";
import { derivePaymentStatus } from "@/domain/payment-status";
import { normalizePhone } from "@/domain/phone";
import { audit } from "./audit";
import { ANY_BARBER, SLOT_TAKEN_MESSAGE, assignBarber, nextRef, saveBooking } from "./bookings-core";
import { setConsent } from "./consent";
import { findOrCreateCustomer } from "./customers";
import { findSalonBySlug, forSalon, type PublicSalon } from "./db";
import { bookingLinkExpiry, signBookingToken, verifyBookingToken } from "./links";
import { planBookingMessages, skipPendingForBooking, skipPendingWinback } from "./messaging/queue";
import { upcomingDays } from "./slots";

export { ANY_BARBER } from "./bookings-core";
export { slotsFor, type DayOption, type SlotOption } from "./slots";

export const DAYS_SHOWN = 14;

export async function loadBookingPage(slug: string) {
  const salon = await findSalonBySlug(slug);
  if (!salon || !salon.bookingEnabled) return null;
  const db = forSalon(salon.id);
  const [services, barbers, openingHours, days] = await Promise.all([
    db.service.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.barber.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.openingHours.findMany(),
    upcomingDays(db, salon.timezone, DAYS_SHOWN),
  ]);
  const todayHours = openingHours.filter((o) => o.weekday === days[0].weekday && !days[0].closed);
  const closesTodayMin = todayHours.length ? Math.max(...todayHours.map((o) => o.endMin)) : null;
  return {
    salon,
    services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceMinor: s.priceMinor })),
    barbers: barbers.map((b) => ({ id: b.id, name: b.displayName })),
    days,
    closesTodayMin,
  };
}

export const bookingInput = z.object({
  serviceId: z.string().min(1),
  barber: z.string().min(1),
  startsAt: z.iso.datetime(),
  name: z.string().trim().min(2, "Please enter your name").max(80),
  phone: z.string().trim().min(6, "Please enter your WhatsApp number"),
  marketing: z.boolean(),
});
export type BookingInput = z.infer<typeof bookingInput>;

export type BookingResult =
  | { ok: true; bookingId: string; token: string }
  | { ok: false; error: "invalid_phone" | "slot_taken" | "invalid"; message: string };

export async function createOnlineBooking(salon: PublicSalon, input: BookingInput): Promise<BookingResult> {
  const phone = normalizePhone(input.phone, salon.countryCode);
  if (!phone.ok) {
    // Local formats are read as the salon's country, so a visitor's foreign number needs its "+" code.
    const country = COUNTRIES[salon.countryCode]?.name;
    const outside = country ? `from outside ${country}` : "from another country";
    return {
      ok: false,
      error: "invalid_phone",
      message: `That doesn't look like a valid WhatsApp number. If it's ${outside}, start with + and the country code.`,
    };
  }

  const db = forSalon(salon.id);
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) return { ok: false, error: "invalid", message: "Please choose a service." };

  const startsAt = new Date(input.startsAt);
  const now = new Date();
  const barber = await assignBarber(db, salon, service, input.barber, startsAt, now);
  if (!barber) return { ok: false, error: "slot_taken", message: SLOT_TAKEN_MESSAGE };

  // Customer, consent, booking and its messages are saved together or not at all.
  const saved = await saveBooking(db, async (tx, attempt) => {
    const { customer } = await findOrCreateCustomer(tx, salon.id, { name: input.name, phoneE164: phone.e164 });
    const consent = { salonId: salon.id, customerId: customer.id, granted: true, source: "BOOKING_PAGE" as const };
    await setConsent(tx, { ...consent, purpose: "UTILITY", wording: UTILITY_CONSENT_WORDING });
    if (input.marketing) await setConsent(tx, { ...consent, purpose: "MARKETING", wording: MARKETING_CONSENT_WORDING });

    const booking = await tx.booking.create({
      data: {
        salonId: salon.id,
        ref: await nextRef(tx, salon.name, attempt),
        customerId: customer.id,
        barberId: barber.id,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (service.durationMin + service.bufferMin) * 60_000),
        status: salon.autoConfirm ? "CONFIRMED" : "PENDING",
        source: "ONLINE",
        priceMinor: service.priceMinor,
        currency: service.currency,
      },
    });
    await planBookingMessages(tx, salon, { ...booking, customer, service, barber }, now, { confirmation: true });
    await skipPendingWinback(tx, customer.id, "booked_since");
    return booking;
  });
  if (!saved.ok) return { ok: false, error: "slot_taken", message: SLOT_TAKEN_MESSAGE };
  const b = saved.value;
  return { ok: true, bookingId: b.id, token: signBookingToken(b.id, bookingLinkExpiry(b.endsAt)) };
}

/** The confirmation / manage page, reached only through a signed link (US-11). */
export async function loadBookingByToken(slug: string, token: string) {
  const verified = verifyBookingToken(token);
  if (!verified) return null;
  const salon = await findSalonBySlug(slug);
  if (!salon) return null;
  const booking = await forSalon(salon.id).booking.findFirst({
    where: { id: verified.bookingId },
    include: { customer: true, service: true, barber: true, payments: true },
  });
  if (!booking) return null;
  const pay = derivePaymentStatus(booking.priceMinor, booking.payments);
  const minutesToStart = (booking.startsAt.getTime() - Date.now()) / 60_000;
  return {
    salon,
    token,
    booking: {
      id: booking.id,
      ref: booking.ref,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      createdAt: booking.createdAt.toISOString(),
      status: booking.status,
      priceMinor: booking.priceMinor,
      currency: booking.currency,
      firstName: booking.customer.name.split(" ")[0],
      serviceId: booking.serviceId,
      serviceName: booking.service.name,
      durationMin: booking.service.durationMin,
      barberId: booking.barberId,
      barberName: booking.barber.displayName,
      paymentStatus: pay.status,
      balanceMinor: pay.balanceMinor,
      canPayOnline: onlinePaymentsReady(salon) && pay.balanceMinor > 0 && booking.status !== "CANCELLED" && booking.status !== "NO_SHOW",
      // BR-B4: customers can change it themselves until the cutoff.
      canChange:
        (booking.status === "CONFIRMED" || booking.status === "PENDING") && minutesToStart >= salon.cancelCutoffMinutes,
    },
  };
}

export type ManageResult = { ok: true; token: string } | { ok: false; message: string };

async function manageable(slug: string, token: string) {
  const data = await loadBookingByToken(slug, token);
  if (!data) return { error: "This link has expired. Please contact the salon." } as const;
  if (!data.booking.canChange) {
    return { error: "It's too close to your appointment to change it online. Please contact the salon." } as const;
  }
  return data;
}

/** US-11 / BR-B4: customer cancels through their signed link. */
export async function cancelByCustomer(slug: string, token: string): Promise<ManageResult> {
  const data = await manageable(slug, token);
  if ("error" in data) return { ok: false, message: data.error! };
  const db = forSalon(data.salon.id);
  const check = checkTransition(data.booking.status, "CANCELLED", {
    now: new Date(),
    startsAt: new Date(data.booking.startsAt),
    noShowGraceMinutes: data.salon.noShowGraceMinutes,
    isOwner: false,
  });
  if (!check.ok) return { ok: false, message: "This booking can't be cancelled." };
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: data.booking.id }, data: { status: "CANCELLED", cancelReason: "customer" } });
    await skipPendingForBooking(tx, data.booking.id, "booking_cancelled");
    await audit(tx, {
      salonId: data.salon.id,
      actorId: null,
      actorType: "customer",
      action: "booking.status_changed",
      entityType: "Booking",
      entityId: data.booking.id,
      before: { status: data.booking.status },
      after: { status: "CANCELLED", by: "customer" },
    });
  });
  return { ok: true, token };
}

/** US-11 / BR-B6: customer moves their booking to another free time with the same service. */
export async function rescheduleByCustomer(slug: string, token: string, newStartIso: string): Promise<ManageResult> {
  const data = await manageable(slug, token);
  if ("error" in data) return { ok: false, message: data.error! };
  const { salon, booking } = data;
  const db = forSalon(salon.id);
  const service = await db.service.findFirstOrThrow({ where: { id: booking.serviceId } });
  const startsAt = new Date(newStartIso);
  const now = new Date();
  // Keep the same barber if free, otherwise any free barber.
  const barber =
    (await assignBarber(db, salon, service, booking.barberId, startsAt, now, booking.id)) ??
    (await assignBarber(db, salon, service, ANY_BARBER, startsAt, now, booking.id));
  if (!barber) return { ok: false, message: SLOT_TAKEN_MESSAGE };
  const endsAt = new Date(startsAt.getTime() + (service.durationMin + service.bufferMin) * 60_000);

  const saved = await saveBooking(db, async (tx) => {
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { startsAt, endsAt, barberId: barber.id },
      include: { customer: true, service: true, barber: true },
    });
    await skipPendingForBooking(tx, booking.id, "rescheduled");
    await planBookingMessages(tx, salon, updated, now, { confirmation: true });
    await audit(tx, {
      salonId: salon.id,
      actorId: null,
      actorType: "customer",
      action: "booking.rescheduled",
      entityType: "Booking",
      entityId: booking.id,
      before: { startsAt: booking.startsAt, barberId: booking.barberId },
      after: { startsAt: startsAt.toISOString(), barberId: barber.id },
    });
    return updated;
  });
  if (!saved.ok) return { ok: false, message: SLOT_TAKEN_MESSAGE };
  return { ok: true, token: signBookingToken(booking.id, bookingLinkExpiry(endsAt)) };
}
