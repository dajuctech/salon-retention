// Scheduled jobs (ADR-0004), safe to run every hour: each step is idempotent per salon-local day.
//  - birthday messages (BR-R5), queued for 09:00 salon time
//  - win-back drafts for the owner's approval queue (BR-R3a/b)
//  - expiring win-back drafts not approved within 7 days (BR-R3c)
import { firstName } from "@/domain/format";
import { isBirthdayToday, whyNow, winbackDecision } from "@/domain/messaging-rules";
import { NO_OFFER_BIRTHDAY_LINE, isPromotionActive, offerLine } from "@/domain/offers";
import { DAY_MS, atLocal, localDateKey, localParts } from "@/domain/time";
import { forSalon, unscopedDb } from "@/server/db";
import { bookingPageUrl, enqueue } from "@/server/messaging/queue";
import { log } from "@/server/log";

const DRAFT_TTL_DAYS = 7;

export type DailySummary = { salons: number; birthdays: number; winbackDrafts: number; expiredDrafts: number };

export async function runDailyJobs(opts: { now?: Date; salonId?: string } = {}): Promise<DailySummary> {
  const now = opts.now ?? new Date();
  const salons = await unscopedDb().salon.findMany({ where: opts.salonId ? { id: opts.salonId } : {} });
  const summary: DailySummary = { salons: salons.length, birthdays: 0, winbackDrafts: 0, expiredDrafts: 0 };
  for (const salon of salons) {
    // One salon's problem must not stop the jobs for every other salon.
    try {
      if (salon.birthdayMessageOn) summary.birthdays += await queueBirthdays(salon, now);
      if (salon.winbackOn) summary.winbackDrafts += await draftWinbacks(salon, now);
      summary.expiredDrafts += await expireDrafts(salon.id, now);
    } catch (err) {
      log.error("daily.salon_failed", err, { salonId: salon.id });
    }
  }
  return summary;
}

type Salon = Awaited<ReturnType<ReturnType<typeof unscopedDb>["salon"]["findMany"]>>[number];

async function activeBirthdayOffer(salon: Salon, now: Date): Promise<{ line: string; promotionId?: string }> {
  const db = forSalon(salon.id);
  const today = localDateKey(now, salon.timezone);
  const promos = await db.promotion.findMany({ where: { isBirthday: true, active: true } });
  const promo = promos.find((p) => isPromotionActive(p, today));
  if (!promo) return { line: NO_OFFER_BIRTHDAY_LINE };
  const services = await db.service.findMany({ where: { id: { in: promo.serviceIds } }, select: { name: true } });
  return {
    line: offerLine({ kind: promo.kind, value: promo.value, serviceNames: services.map((s) => s.name), endsOn: promo.endsOn }, salon.currency),
    promotionId: promo.id,
  };
}

async function queueBirthdays(salon: Salon, now: Date): Promise<number> {
  const db = forSalon(salon.id);
  const t = localParts(now, salon.timezone);
  const candidates = await db.customer.findMany({
    where: {
      birthMonth: t.month,
      birthDay: t.month === 2 && t.day === 28 ? { in: [28, 29] } : t.day,
      anonymisedAt: null,
      marketingConsent: true,
      phoneInvalid: false,
    },
  });
  const birthdays = candidates.filter((c) => isBirthdayToday(c.birthMonth!, c.birthDay!, now, salon.timezone));
  if (birthdays.length === 0) return 0;
  const offer = await activeBirthdayOffer(salon, now);
  const nineAm = atLocal(salon.timezone, t.year, t.month, t.day, 9);
  let created = 0;
  for (const c of birthdays) {
    const result = await enqueue(db, salon, {
      type: "BIRTHDAY",
      customerId: c.id,
      promotionId: offer.promotionId,
      values: {
        first_name: firstName(c.name),
        salon_name: salon.name,
        offer_line: offer.line,
        booking_link: bookingPageUrl(salon.slug),
      },
      scheduledFor: nineAm > now ? nineAm : now,
      subjectId: c.id,
    }).catch((err) => {
      log.error("daily.birthday_failed", err, { salonId: salon.id, customerId: c.id });
      return "error" as const;
    });
    if (result === "created") created++;
  }
  return created;
}

/** Values for a win-back template, recomputed whenever the draft is re-rendered. */
export function winbackValues(
  salon: { name: string; slug: string },
  customer: { name: string; lastVisitAt: Date },
  barberName: string,
  now: Date,
  offer?: string,
): Record<string, string> {
  return {
    first_name: firstName(customer.name),
    salon_name: salon.name,
    barber_name: barberName,
    weeks_since_visit: String(Math.max(1, Math.round((now.getTime() - customer.lastVisitAt.getTime()) / (7 * DAY_MS)))),
    days_since_visit: String(Math.max(1, Math.floor((now.getTime() - customer.lastVisitAt.getTime()) / DAY_MS))),
    booking_link: bookingPageUrl(salon.slug),
    ...(offer ? { offer_line: offer } : {}),
  };
}

async function draftWinbacks(salon: Salon, now: Date): Promise<number> {
  const db = forSalon(salon.id);
  const customers = await db.customer.findMany({
    where: { lastVisitAt: { not: null }, marketingConsent: true, holdout: false, anonymisedAt: null, phoneInvalid: false },
    include: { preferredBarber: true },
  });
  if (customers.length === 0) return 0;
  const ids = customers.map((c) => c.id);
  const [upcoming, lastWinbacks, lastBarbers] = await Promise.all([
    db.booking.findMany({
      where: { customerId: { in: ids }, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } },
      select: { customerId: true },
    }),
    db.message.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, type: "WINBACK" }, _max: { createdAt: true } }),
    db.booking.findMany({
      where: { customerId: { in: ids }, status: "COMPLETED" },
      orderBy: { startsAt: "desc" },
      distinct: ["customerId"],
      select: { customerId: true, barber: { select: { displayName: true } } },
    }),
  ]);
  const hasUpcoming = new Set(upcoming.map((u) => u.customerId));
  const lastWinbackAt = new Map(lastWinbacks.map((w) => [w.customerId, w._max.createdAt]));
  const lastBarber = new Map(lastBarbers.map((b) => [b.customerId, b.barber.displayName]));

  let created = 0;
  for (const c of customers) {
    const gap = c.usualGapDays ?? 21;
    const decision = winbackDecision({
      now,
      lastVisitAt: c.lastVisitAt,
      usualGapDays: gap,
      graceDays: salon.winbackGraceDays,
      cooldownDays: salon.winbackCooldownDays,
      lastWinbackAt: lastWinbackAt.get(c.id) ?? null,
      hasUpcomingBooking: hasUpcoming.has(c.id),
      marketingConsent: c.marketingConsent,
      holdout: c.holdout,
    });
    if (!decision.due) continue;
    const barberName = c.preferredBarber?.displayName ?? lastBarber.get(c.id) ?? "us";
    // One bad record must not stop the job for everyone else.
    const result = await enqueue(db, salon, {
      type: "WINBACK",
      variant: "friendly",
      customerId: c.id,
      values: winbackValues(salon, { name: c.name, lastVisitAt: c.lastVisitAt! }, barberName, now),
      scheduledFor: now,
      subjectId: c.id,
      status: "DRAFT",
      whyNow: whyNow(now, c.lastVisitAt!, gap, barberName === "us" ? undefined : barberName),
    }).catch((err) => {
      log.error("daily.winback_failed", err, { salonId: salon.id, customerId: c.id });
      return "error" as const;
    });
    if (result === "created") created++;
  }
  return created;
}

async function expireDrafts(salonId: string, now: Date): Promise<number> {
  const { count } = await forSalon(salonId).message.updateMany({
    where: { status: "DRAFT", createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_DAYS * DAY_MS) } },
    data: { status: "SKIPPED", skipReason: "expired" },
  });
  return count;
}
