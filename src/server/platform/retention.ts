// Data retention (NFR-DATA, security-privacy.md §Retention). Runs with the daily jobs; every step
// is idempotent, so running it hourly or twice is harmless.
//  - customers: anonymised 24 months after their last visit (none upcoming)
//  - message text: removed after 12 months; message rows deleted after 24 months
//  - inbound WhatsApp text: removed after 12 months
//  - AI generation log: deleted after 12 months; audit log: deleted after 24 months
//  - bookings and payments: kept 6 years (financial records), then deleted
//  - rate-limit counters, expired sign-in codes and sessions: deleted when stale
import { DAY_MS } from "@/domain/time";
import { Prisma } from "@/generated/prisma/client";
import { anonymiseCustomerRecord } from "@/server/customers";
import { forSalon, unscopedDb } from "@/server/db";
import { log } from "@/server/log";

export const RETENTION = {
  customerInactiveMonths: 24,
  messageTextMonths: 12,
  messageRowMonths: 24,
  aiLogMonths: 12,
  auditLogMonths: 24,
  financialYears: 6,
} as const;

export type RetentionSummary = {
  customersAnonymised: number;
  messagesRedacted: number;
  messagesDeleted: number;
  inboundRedacted: number;
  aiLogsDeleted: number;
  auditLogsDeleted: number;
  bookingsDeleted: number;
  housekeeping: number;
};

const monthsAgo = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

export async function runRetention(opts: { now?: Date; salonId?: string } = {}): Promise<RetentionSummary> {
  const now = opts.now ?? new Date();
  const sum: RetentionSummary = { customersAnonymised: 0, messagesRedacted: 0, messagesDeleted: 0, inboundRedacted: 0, aiLogsDeleted: 0, auditLogsDeleted: 0, bookingsDeleted: 0, housekeeping: 0 };
  const salons = await unscopedDb().salon.findMany({ where: opts.salonId ? { id: opts.salonId } : {}, select: { id: true } });
  for (const { id } of salons) {
    try {
      await retainSalon(id, now, sum);
    } catch (err) {
      log.error("retention.salon_failed", err, { salonId: id });
    }
  }
  if (!opts.salonId) sum.housekeeping = await housekeeping(now);
  log.info("retention.done", sum);
  return sum;
}

async function retainSalon(salonId: string, now: Date, sum: RetentionSummary) {
  const db = forSalon(salonId);
  const inactiveSince = monthsAgo(now, RETENTION.customerInactiveMonths);

  // Customers: last visit (or, if they never visited, sign-up) before the cut-off, nothing upcoming.
  const stale = await db.customer.findMany({
    where: {
      anonymisedAt: null,
      OR: [{ lastVisitAt: { lt: inactiveSince } }, { lastVisitAt: null, createdAt: { lt: inactiveSince } }],
      bookings: { none: { startsAt: { gte: inactiveSince } } },
    },
    select: { id: true },
    take: 500,
  });
  for (const c of stale) {
    await db.$transaction(async (tx) => {
      await anonymiseCustomerRecord(tx, c.id, now);
      await tx.auditLog.create({ data: { salonId, actorId: null, actorType: "system", action: "customer.anonymised_retention", entityType: "Customer", entityId: c.id } });
    });
    sum.customersAnonymised++;
  }

  // Old rows go first, so their text isn't redacted only to be deleted.
  sum.messagesDeleted += (await db.message.deleteMany({ where: { createdAt: { lt: monthsAgo(now, RETENTION.messageRowMonths) } } })).count;
  const textCutoff = monthsAgo(now, RETENTION.messageTextMonths);
  sum.messagesRedacted += (
    await db.message.updateMany({
      where: { createdAt: { lt: textCutoff }, status: { notIn: ["DRAFT", "QUEUED", "SENDING"] }, NOT: { renderedText: { in: ["[expired]", "[deleted]"] } } },
      data: { renderedText: "[expired]", whyNow: null, variables: Prisma.DbNull },
    })
  ).count;
  sum.inboundRedacted += (
    await db.inboundMessage.updateMany({ where: { receivedAt: { lt: textCutoff }, NOT: { text: "[expired]" } }, data: { text: "[expired]" } })
  ).count;
  sum.aiLogsDeleted += (await db.aIGeneration.deleteMany({ where: { createdAt: { lt: monthsAgo(now, RETENTION.aiLogMonths) } } })).count;
  sum.auditLogsDeleted += (await db.auditLog.deleteMany({ where: { createdAt: { lt: monthsAgo(now, RETENTION.auditLogMonths) } } })).count;

  // Financial records: bookings with their payments and loyalty redemptions, older than 6 years.
  const old = await db.booking.findMany({ where: { startsAt: { lt: monthsAgo(now, RETENTION.financialYears * 12) } }, select: { id: true }, take: 1000 });
  if (old.length) {
    const ids = old.map((b) => b.id);
    await db.$transaction(async (tx) => {
      await tx.loyaltyRedemption.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.payment.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.booking.deleteMany({ where: { id: { in: ids } } });
    });
    sum.bookingsDeleted += ids.length;
  }
}

/** Platform-wide housekeeping: stale rate-limit windows (a week old), expired sign-in codes and sessions. */
async function housekeeping(now: Date): Promise<number> {
  const db = unscopedDb();
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const weekAgoSec = Math.floor((now.getTime() - 7 * DAY_MS) / 1000);
  const [hits, codes, sessions] = await Promise.all([
    db.rateLimitHit.deleteMany({ where: { window: { lt: weekAgoSec } } }),
    db.verification.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
    db.session.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
  ]);
  return hits.count + codes.count + sessions.count;
}
