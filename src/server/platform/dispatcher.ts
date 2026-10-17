// Message dispatcher (ADR-0004). Claims due messages with FOR UPDATE SKIP LOCKED so parallel runs
// never send the same message, then re-checks every rule at send time: a message queued before an
// opt-out, a cancellation or a reschedule must not go out.
import {
  frequencyCapAllows,
  isQuietTime,
  nextAllowedSendTime,
  retryDelayMs,
} from "@/domain/messaging-rules";
import { messageCategory, templateParams, type MessageType } from "@/domain/templates";
import { localDateKey } from "@/domain/time";
import { unscopedDb } from "@/server/db";
import { getProvider } from "@/server/messaging/provider";

const LEASE_MS = 10 * 60_000;
const SESSION_WINDOW_MS = 24 * 3600_000;
const BOOKING_TYPES: MessageType[] = ["BOOKING_CONFIRMATION", "REMINDER_DAY_BEFORE", "REMINDER_2H"];

export type DispatchSummary = { sent: number; failed: number; skipped: number; deferred: number; retrying: number };

export async function dispatchDue(opts: { now?: Date; limit?: number; salonId?: string } = {}): Promise<DispatchSummary> {
  const now = opts.now ?? new Date();
  const summary: DispatchSummary = { sent: 0, failed: 0, skipped: 0, deferred: 0, retrying: 0 };
  if (process.env.MESSAGING_PAUSED === "true") return summary;
  const db = unscopedDb();

  // Runbook "Dispatcher stuck": a crashed run leaves SENDING rows; the lease expiry releases them.
  await db.message.updateMany({
    where: { status: "SENDING", nextAttemptAt: { lt: now } },
    data: { status: "QUEUED" },
  });

  const lease = new Date(now.getTime() + LEASE_MS);
  const limit = opts.limit ?? 50;
  const claimed = opts.salonId
    ? await db.$queryRaw<{ id: string }[]>`
        UPDATE "Message" SET status = 'SENDING', attempts = attempts + 1, "nextAttemptAt" = ${lease}
        WHERE id IN (
          SELECT m.id FROM "Message" m JOIN salon s ON s.id = m."salonId"
          WHERE m.status = 'QUEUED' AND COALESCE(m."nextAttemptAt", m."scheduledFor") <= ${now}
            AND NOT s."messagingPaused" AND m."salonId" = ${opts.salonId}
          ORDER BY m."scheduledFor" LIMIT ${limit} FOR UPDATE OF m SKIP LOCKED)
        RETURNING id`
    : await db.$queryRaw<{ id: string }[]>`
        UPDATE "Message" SET status = 'SENDING', attempts = attempts + 1, "nextAttemptAt" = ${lease}
        WHERE id IN (
          SELECT m.id FROM "Message" m JOIN salon s ON s.id = m."salonId"
          WHERE m.status = 'QUEUED' AND COALESCE(m."nextAttemptAt", m."scheduledFor") <= ${now}
            AND NOT s."messagingPaused"
          ORDER BY m."scheduledFor" LIMIT ${limit} FOR UPDATE OF m SKIP LOCKED)
        RETURNING id`;

  for (const { id } of claimed) {
    const outcome = await processMessage(id, now).catch(async () => {
      // Unexpected error: release for a retry rather than leaving it stuck.
      await db.message.update({ where: { id }, data: { status: "QUEUED", nextAttemptAt: new Date(now.getTime() + 60_000) } });
      return "retrying" as const;
    });
    summary[outcome]++;
  }
  return summary;
}

type Outcome = keyof DispatchSummary;

async function processMessage(id: string, now: Date): Promise<Outcome> {
  const db = unscopedDb();
  const m = await db.message.findUniqueOrThrow({
    where: { id },
    include: { customer: { include: { conversation: true } }, template: true, booking: true, salon: true },
  });
  const finish = (data: Parameters<typeof db.message.update>[0]["data"]) => db.message.update({ where: { id }, data });
  const skip = async (reason: string) => {
    await finish({ status: "SKIPPED", skipReason: reason, nextAttemptAt: null });
    return "skipped" as const;
  };
  const fail = async (reason: string) => {
    await finish({ status: "FAILED", failureReason: reason, nextAttemptAt: null });
    return "failed" as const;
  };

  const c = m.customer;
  const category = messageCategory(m.type);
  if (c.anonymisedAt) return skip("customer_deleted");
  if (m.type !== "OPTOUT_CONFIRMATION") {
    // Session replies answer the customer's own message, so they need no prior consent.
    if (category === "UTILITY" && !c.utilityConsent) return skip("no_consent");
    if (category === "MARKETING" && !c.marketingConsent) return skip("no_consent");
    if (c.phoneInvalid) return fail("not_on_whatsapp");
  }

  if (BOOKING_TYPES.includes(m.type) && m.booking) {
    if (m.booking.status !== "PENDING" && m.booking.status !== "CONFIRMED") return skip("booking_changed");
    if (m.type !== "BOOKING_CONFIRMATION" && m.booking.startsAt <= now) return skip("expired");
  }

  // A birthday wish is only sent on the birthday itself (salon time), never a day late.
  const birthdayDay = m.type === "BIRTHDAY" ? localDateKey(m.scheduledFor, m.salon.timezone) : null;
  if (birthdayDay && localDateKey(now, m.salon.timezone) !== birthdayDay) return skip("birthday_passed");

  if (category === "MARKETING") {
    const quiet = { timeZone: m.salon.timezone, start: m.salon.quietHoursStart, end: m.salon.quietHoursEnd };
    if (isQuietTime(now, quiet)) {
      if (birthdayDay && localDateKey(nextAllowedSendTime(now, quiet), m.salon.timezone) !== birthdayDay) return skip("birthday_passed");
      // BR-R7: not a failed attempt, just later.
      await finish({ status: "QUEUED", attempts: { decrement: 1 }, nextAttemptAt: nextAllowedSendTime(now, quiet) });
      return "deferred";
    }
    const recent = await db.message.findMany({
      where: {
        customerId: c.id,
        type: { in: ["WINBACK", "BIRTHDAY", "PROMOTION"] },
        status: { in: ["SENT", "DELIVERED", "READ"] },
        sentAt: { gte: new Date(now.getTime() - 7 * 24 * 3600_000) },
      },
      select: { sentAt: true },
    });
    if (!frequencyCapAllows(recent.map((r) => r.sentAt!), now, m.salon.marketingCapPerWeek)) return skip("frequency_cap");
  }

  const provider = getProvider();
  let result;
  if (category === "SESSION") {
    const lastInbound = c.conversation?.lastInboundAt;
    if (!lastInbound || now.getTime() - lastInbound.getTime() > SESSION_WINDOW_MS) return fail("outside_24h_window");
    result = await provider.sendText({ to: c.phoneE164, text: m.renderedText });
  } else {
    if (!m.template || m.template.approval !== "APPROVED") return fail("template_not_approved");
    const params = templateParams(m.template.variables, (m.variables ?? {}) as Record<string, string>);
    result = await provider.sendTemplate({
      to: c.phoneE164,
      templateName: m.template.name,
      language: m.template.language,
      params,
      text: m.renderedText,
    });
  }

  if (result.ok) {
    await finish({
      status: result.delivered ? "DELIVERED" : "SENT",
      sentAt: now,
      deliveredAt: result.delivered ? now : null,
      providerMessageId: result.providerMessageId,
      failureReason: null,
      nextAttemptAt: null,
    });
    return "sent";
  }
  if (result.retryable) {
    const delay = retryDelayMs(m.attempts);
    if (delay !== null) {
      await finish({ status: "QUEUED", failureReason: result.reason, nextAttemptAt: new Date(now.getTime() + delay) });
      return "retrying";
    }
  }
  if (result.reason === "not_on_whatsapp") {
    await db.customer.update({ where: { id: c.id }, data: { phoneInvalid: true } });
  }
  return fail(result.reason);
}

/** Sends one message immediately (staff inbox replies), using the same checks. */
export async function dispatchOne(messageId: string, now = new Date()): Promise<Outcome | "not_due"> {
  const db = unscopedDb();
  const { count } = await db.message.updateMany({
    where: { id: messageId, status: "QUEUED" },
    data: { status: "SENDING", attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (count === 0) return "not_due";
  return processMessage(messageId, now);
}
