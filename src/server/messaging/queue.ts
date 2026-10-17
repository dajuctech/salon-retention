// Creating messages (ADR-0004: the Message table is the queue). The dispatcher sends them.
import { firstName, formatDateTimeLong, formatTime } from "@/domain/format";
import { messageIdempotencyKey, planAppointmentReminders } from "@/domain/messaging-rules";
import { renderTemplate, templateParams, type MessageType } from "@/domain/templates";
import type { DbLike } from "@/server/audit";
import { bookingLinkExpiry, signBookingToken } from "@/server/links";

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
export const bookingPageUrl = (slug: string) => `${appUrl()}/${slug}`;
export const manageUrl = (slug: string, token: string) => `${appUrl()}/${slug}/booking/${token}`;

export function manageLinkFor(slug: string, booking: { id: string; endsAt: Date }): string {
  return manageUrl(slug, signBookingToken(booking.id, bookingLinkExpiry(booking.endsAt)));
}

type SalonLike = { id: string; slug: string; name: string; timezone: string };

export type EnqueueArgs = {
  type: MessageType;
  variant?: string;
  customerId: string;
  bookingId?: string;
  promotionId?: string;
  values: Record<string, string>;
  scheduledFor: Date;
  /** Distinguishes messages of the same type for the same day (BR-R8). */
  subjectId: string;
  status?: "QUEUED" | "DRAFT";
  whyNow?: string;
};

/** Finds the approved template for a type: the salon's own version first, then the platform's. */
export async function approvedTemplate(db: DbLike, type: MessageType, variant?: string) {
  return db.messageTemplate.findFirst({
    where: { type, approval: "APPROVED", ...(variant ? { variant } : {}) },
    orderBy: [{ salonId: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
}

/**
 * Queues a template message. Idempotent: a second call with the same key does nothing (BR-R8).
 * Without an approved template the message is recorded as SKIPPED so the gap is visible.
 */
export async function enqueue(db: DbLike, salon: SalonLike, a: EnqueueArgs): Promise<"created" | "duplicate"> {
  const template = await approvedTemplate(db, a.type, a.variant);
  const idempotencyKey = messageIdempotencyKey(salon.id, a.type, a.subjectId, a.scheduledFor, salon.timezone);
  let renderedText = "";
  let status: "QUEUED" | "DRAFT" | "SKIPPED" = a.status ?? "QUEUED";
  let skipReason: string | null = null;
  if (template) {
    renderedText = renderTemplate(template.body, templateParams(template.variables, a.values));
  } else {
    status = "SKIPPED";
    skipReason = "template_not_approved";
  }
  // createMany + skipDuplicates (ON CONFLICT DO NOTHING) so a duplicate never aborts the caller's transaction.
  const { count } = await db.message.createMany({
    data: [
      {
        salonId: salon.id,
        customerId: a.customerId,
        bookingId: a.bookingId ?? null,
        promotionId: a.promotionId ?? null,
        type: a.type,
        templateId: template?.id ?? null,
        variables: a.values,
        renderedText,
        whyNow: a.whyNow ?? null,
        status,
        skipReason,
        idempotencyKey,
        scheduledFor: a.scheduledFor,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1 ? "created" : "duplicate";
}

type BookingForMessages = {
  id: string;
  ref: string;
  startsAt: Date;
  endsAt: Date;
  customer: { id: string; name: string };
  service: { name: string };
  barber: { displayName: string };
};

type ReminderSalon = SalonLike & {
  dayBeforeReminderOn: boolean;
  dayBeforeReminderHour: number;
  shortReminderOn: boolean;
  shortReminderHours: number;
};

/** Booking confirmation plus the BR-R4 reminders for a booking's current time. */
export async function planBookingMessages(
  db: DbLike,
  salon: ReminderSalon,
  booking: BookingForMessages,
  now: Date,
  opts: { confirmation: boolean },
): Promise<void> {
  const tz = salon.timezone;
  const iso = booking.startsAt.toISOString();
  const common = {
    first_name: firstName(booking.customer.name),
    service_name: booking.service.name.toLowerCase(),
    salon_name: salon.name,
    barber_name: booking.barber.displayName,
    booking_ref: booking.ref,
    manage_link: manageLinkFor(salon.slug, booking),
    date_time_local: formatDateTimeLong(iso, tz),
    time_local: formatTime(iso, tz),
  };
  // Each booking time gets its own keys, so a reschedule queues fresh messages.
  const subjectId = `${booking.id}@${booking.startsAt.getTime()}`;

  if (opts.confirmation) {
    await enqueue(db, salon, {
      type: "BOOKING_CONFIRMATION",
      customerId: booking.customer.id,
      bookingId: booking.id,
      values: common,
      scheduledFor: now,
      subjectId,
    });
  }
  const reminders = planAppointmentReminders(booking.startsAt, now, {
    timeZone: tz,
    dayBeforeOn: salon.dayBeforeReminderOn,
    dayBeforeHour: salon.dayBeforeReminderHour,
    shortOn: salon.shortReminderOn,
    shortHours: salon.shortReminderHours,
  });
  for (const r of reminders) {
    await enqueue(db, salon, {
      type: r.type,
      customerId: booking.customer.id,
      bookingId: booking.id,
      values: common,
      scheduledFor: r.sendAt,
      subjectId,
    });
  }
}

/** Stops messages that no longer apply (cancelled, no-show, rescheduled). */
export async function skipPendingForBooking(db: DbLike, bookingId: string, reason: string): Promise<number> {
  const { count } = await db.message.updateMany({
    where: { bookingId, status: { in: ["QUEUED", "DRAFT"] } },
    data: { status: "SKIPPED", skipReason: reason },
  });
  return count;
}

/** A customer who books or visits no longer needs a win-back nudge (BR-R3b). */
export async function skipPendingWinback(db: DbLike, customerId: string, reason: string): Promise<number> {
  const { count } = await db.message.updateMany({
    where: { customerId, type: "WINBACK", status: { in: ["QUEUED", "DRAFT"] } },
    data: { status: "SKIPPED", skipReason: reason },
  });
  return count;
}
