// Demo data matching the design (design/*.pdf): Sharp & Co., Tunde and Chidi, customers with
// months of history. Development only. Usage: pnpm db:seed (re-running replaces the demo salon).
//
// Demo logins (password for all three: demo-password-123):
//   owner@sharpandco.test · reception@sharpandco.test · tunde@sharpandco.test (barber)
import "dotenv/config";
import { usualGapDays } from "../src/domain/messaging-rules";
import { DAY_MS, atLocal, localParts } from "../src/domain/time";
import { getAuth } from "../src/server/auth/auth";
import { forSalon, unscopedDb } from "../src/server/db";
import { planBookingMessages } from "../src/server/messaging/queue";
import { runDailyJobs } from "../src/server/platform/daily";
import { ensurePlatformTemplates } from "../src/server/platform/templates";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

const db = unscopedDb();
const SALON_ID = "demo-sharpandco";
const TZ = "Africa/Lagos";
const PASSWORD = "demo-password-123";
const h = (hh: number) => hh * 60;
const now = new Date();
const today = localParts(now, TZ);
const at = (dayOffset: number, hh: number, mm = 0) => atLocal(TZ, today.year, today.month, today.day + dayOffset, hh, mm);

async function removeDemo() {
  const where = { salonId: SALON_ID };
  for (const model of ["payment", "loyaltyRedemption", "message", "inboundMessage", "conversation", "consent", "booking", "customer", "auditLog", "aIGeneration"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[model] as any).deleteMany({ where });
  }
  await db.messageTemplate.deleteMany({ where });
  await db.salon.deleteMany({ where: { id: SALON_ID } });
  await db.user.deleteMany({ where: { email: { endsWith: "@sharpandco.test" } } });
}

async function user(name: string, email: string) {
  const res = await getAuth().api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return res.user.id;
}

async function main() {
  await removeDemo();
  await ensurePlatformTemplates();

  await db.salon.create({
    data: {
      id: SALON_ID,
      name: "Sharp & Co.",
      slug: "sharpandco",
      countryCode: "NG",
      timezone: TZ,
      currency: "NGN",
      whatsappNumber: "+234 801 555 0100",
      slotGridMinutes: 30,
      loyaltyOn: true,
      paymentProvider: "PAYSTACK", // simulated locally (PAYMENTS_MODE=fake)
      paymentProviderAccount: "ACCT_demo_sharpandco",
      paymentAccountReady: true,
      paymentAccountLabel: "Test Bank A ••••0000",
      openingHours: {
        create: [...[1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: h(9), endMin: h(19) })), { weekday: 0, startMin: h(12), endMin: h(17) }],
      },
      services: {
        create: [
          { name: "Haircut", durationMin: 30, priceMinor: 300_000, currency: "NGN", sortOrder: 0, loyaltyReward: true },
          { name: "Haircut + Beard", durationMin: 45, priceMinor: 450_000, currency: "NGN", sortOrder: 1 },
          { name: "Beard trim", durationMin: 20, priceMinor: 200_000, currency: "NGN", sortOrder: 2 },
          { name: "Kids cut", durationMin: 30, priceMinor: 250_000, currency: "NGN", sortOrder: 3 },
        ],
      },
    },
  });

  const ownerId = await user("Ade Bello", "owner@sharpandco.test");
  const receptionId = await user("Ngozi Eze", "reception@sharpandco.test");
  const tundeUserId = await user("Tunde Adewale", "tunde@sharpandco.test");
  await db.member.createMany({
    data: [
      { salonId: SALON_ID, userId: ownerId, role: "owner" },
      { salonId: SALON_ID, userId: receptionId, role: "receptionist" },
    ],
  });
  const tundeMember = await db.member.create({ data: { salonId: SALON_ID, userId: tundeUserId, role: "barber" } });

  const tunde = await db.barber.create({
    data: {
      salonId: SALON_ID,
      displayName: "Tunde",
      memberId: tundeMember.id,
      sortOrder: 0,
      workingHours: { create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ salonId: SALON_ID, weekday, startMin: h(9), endMin: h(18) })) },
    },
  });
  const chidi = await db.barber.create({
    data: {
      salonId: SALON_ID,
      displayName: "Chidi",
      sortOrder: 1,
      workingHours: {
        create: [
          ...[2, 3, 4, 5, 6].map((weekday) => ({ salonId: SALON_ID, weekday, startMin: h(10), endMin: h(19) })),
          { salonId: SALON_ID, weekday: 0, startMin: h(12), endMin: h(17) },
        ],
      },
    },
  });
  const services = await db.service.findMany({ where: { salonId: SALON_ID } });
  const svc = (name: string) => services.find((s) => s.name === name)!;

  const birthdayIn = (days: number) => {
    const b = localParts(new Date(now.getTime() + days * DAY_MS), TZ);
    return { month: b.month, day: b.day };
  };
  // Customers from the design; visits/gap/lastDaysAgo shape their history.
  const people: {
    name: string;
    phone: string;
    visits: number;
    gap: number;
    lastDaysAgo: number;
    barber: "Tunde" | "Chidi";
    service: string;
    marketing?: boolean;
    birthday?: { month: number; day: number };
    notes?: string;
    style?: string;
  }[] = [
    { name: "Segun Bello", phone: "+2348025550147", visits: 8, gap: 21, lastDaysAgo: 35, barber: "Tunde", service: "Haircut", birthday: { month: 11, day: 22 }, notes: "Likes a quiet chair.", style: "Low fade, short on top." },
    { name: "Tobi Williams", phone: "+2348035550148", visits: 4, gap: 24, lastDaysAgo: 42, barber: "Chidi", service: "Haircut" },
    { name: "Dayo Alabi", phone: "+2348065550149", visits: 6, gap: 26, lastDaysAgo: 49, barber: "Tunde", service: "Haircut + Beard" },
    { name: "Kola Adeyemi", phone: "+2348135550150", visits: 16, gap: 14, lastDaysAgo: 14, barber: "Chidi", service: "Haircut + Beard", birthday: birthdayIn(0) },
    { name: "Chinedu Eze", phone: "+2348035550151", visits: 13, gap: 15, lastDaysAgo: 13, barber: "Chidi", service: "Haircut", birthday: birthdayIn(3) },
    { name: "Femi Johnson", phone: "+2348035550152", visits: 8, gap: 20, lastDaysAgo: 22, barber: "Chidi", service: "Beard trim" },
    { name: "Gbenga Ali", phone: "+2348035550153", visits: 5, gap: 18, lastDaysAgo: 18, barber: "Tunde", service: "Haircut" },
    { name: "Ibrahim Musa", phone: "+2348035550154", visits: 2, gap: 21, lastDaysAgo: 21, barber: "Tunde", service: "Kids cut" },
    { name: "Uche Nwosu", phone: "+2348035550155", visits: 7, gap: 21, lastDaysAgo: 12, barber: "Chidi", service: "Haircut + Beard" },
    { name: "Yemi Cole", phone: "+2348035550156", visits: 4, gap: 28, lastDaysAgo: 25, barber: "Tunde", service: "Haircut + Beard" },
    { name: "Sola Peters", phone: "+2348035550157", visits: 3, gap: 30, lastDaysAgo: 29, barber: "Tunde", service: "Haircut" },
    { name: "Hakeem Ade", phone: "+2348035550158", visits: 5, gap: 21, lastDaysAgo: 20, barber: "Tunde", service: "Haircut + Beard" },
    { name: "Chuka Obi", phone: "+2348135550159", visits: 0, gap: 21, lastDaysAgo: 0, barber: "Tunde", service: "Haircut" },
    { name: "Lekan Dada", phone: "+2348035550160", visits: 3, gap: 25, lastDaysAgo: 26, barber: "Chidi", service: "Haircut", marketing: false },
    // Regulars seen in the past week, so every week of the reports has takings, as in a real salon.
    { name: "Musa Bello", phone: "+2348035550161", visits: 6, gap: 14, lastDaysAgo: 4, barber: "Tunde", service: "Haircut" },
    { name: "Tayo Ojo", phone: "+2348035550162", visits: 2, gap: 21, lastDaysAgo: 5, barber: "Tunde", service: "Kids cut" },
    { name: "Obinna Okafor", phone: "+2348035550163", visits: 5, gap: 16, lastDaysAgo: 6, barber: "Chidi", service: "Haircut + Beard" },
    { name: "Seyi Lawal", phone: "+2348035550164", visits: 4, gap: 18, lastDaysAgo: 8, barber: "Chidi", service: "Beard trim" },
    { name: "Ade Balogun", phone: "+2348035550165", visits: 3, gap: 20, lastDaysAgo: 9, barber: "Tunde", service: "Haircut + Beard" },
  ];

  const barberOf = (n: string) => (n === "Tunde" ? tunde : chidi);
  // Every past visit gets its own slot so demo data never trips the double-booking constraint.
  const usedSlots = new Set<string>();
  const freeStart = (dayOffset: number, barberId: string) => {
    for (let m = h(10); m < h(17); m += 60) {
      const key = `${dayOffset}:${barberId}:${m}`;
      if (!usedSlots.has(key)) {
        usedSlots.add(key);
        return at(dayOffset, 0, m);
      }
    }
    throw new Error("No free demo slot");
  };
  let ref = 1000;
  const methods = ["CASH", "TRANSFER", "POS", "CASH", "TRANSFER"] as const;
  const customerIds = new Map<string, string>();

  for (const p of people) {
    const c = await db.customer.create({
      data: {
        salonId: SALON_ID,
        name: p.name,
        phoneE164: p.phone,
        utilityConsent: true,
        marketingConsent: p.marketing ?? true,
        birthMonth: p.birthday?.month,
        birthDay: p.birthday?.day,
        notes: p.notes,
        preferredStyle: p.style,
        createdAt: new Date(now.getTime() - (p.lastDaysAgo + p.visits * p.gap + 5) * DAY_MS),
      },
    });
    customerIds.set(p.name, c.id);
    await db.consent.createMany({
      data: [
        { salonId: SALON_ID, customerId: c.id, purpose: "UTILITY", granted: true, source: "STAFF_VERBAL", wording: "Demo data" },
        ...(p.marketing === false ? [] : [{ salonId: SALON_ID, customerId: c.id, purpose: "MARKETING" as const, granted: true, source: "STAFF_VERBAL" as const, wording: "Demo data" }]),
      ],
    });
    const barber = barberOf(p.barber);
    const service = svc(p.service);
    const visitDates: Date[] = [];
    for (let i = 0; i < p.visits; i++) {
      const daysAgo = p.lastDaysAgo + (p.visits - 1 - i) * p.gap;
      const startsAt = freeStart(-daysAgo, barber.id);
      visitDates.push(startsAt);
      const b = await db.booking.create({
        data: {
          salonId: SALON_ID,
          ref: `SC-${++ref}`,
          customerId: c.id,
          barberId: barber.id,
          serviceId: service.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + service.durationMin * 60_000),
          status: "COMPLETED",
          source: i % 3 === 0 ? "WALK_IN" : "ONLINE",
          priceMinor: service.priceMinor,
          currency: "NGN",
          createdAt: new Date(startsAt.getTime() - 2 * DAY_MS),
        },
      });
      await db.payment.create({
        data: {
          salonId: SALON_ID,
          bookingId: b.id,
          method: methods[ref % methods.length],
          amountMinor: service.priceMinor,
          currency: "NGN",
          createdAt: new Date(startsAt.getTime() + service.durationMin * 60_000),
        },
      });
    }
    if (visitDates.length) {
      await db.customer.update({
        where: { id: c.id },
        data: { visitCount: visitDates.length, lastVisitAt: visitDates.at(-1), usualGapDays: usualGapDays(visitDates, service.returnReminderDays ?? 21) },
      });
    }
  }

  // A running offer, so "With offer" win-backs and offer campaigns can be tried.
  await db.promotion.create({
    data: {
      salonId: SALON_ID,
      name: "Midweek deal",
      kind: "PERCENT",
      value: 10,
      serviceIds: [svc("Haircut").id],
      startsOn: new Date(`${today.year}-${String(today.month).padStart(2, "0")}-01T00:00:00Z`),
      endsOn: new Date(Date.UTC(today.year, today.month + 1, 0)),
    },
  });

  // Today (design p4) and tomorrow.
  const id = (n: string) => customerIds.get(n)!;
  const tdb = forSalon(SALON_ID);
  const salon = await db.salon.findUniqueOrThrow({ where: { id: SALON_ID } });
  type Status = "COMPLETED" | "IN_PROGRESS" | "CONFIRMED" | "NO_SHOW";
  const book = async (name: string, barberName: string, serviceName: string, startsAt: Date, status: Status, paidMinor = 0) => {
    const service = svc(serviceName);
    const barber = barberOf(barberName);
    const b = await db.booking.create({
      data: {
        salonId: SALON_ID,
        ref: `SC-${++ref}`,
        customerId: id(name),
        barberId: barber.id,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + service.durationMin * 60_000),
        status,
        source: "ONLINE",
        priceMinor: service.priceMinor,
        currency: "NGN",
      },
      include: { customer: true, service: true, barber: true },
    });
    if (paidMinor) await db.payment.create({ data: { salonId: SALON_ID, bookingId: b.id, method: "CASH", amountMinor: paidMinor, currency: "NGN" } });
    // Upcoming bookings get their pending reminders, as if booked yesterday.
    if (status === "CONFIRMED" && startsAt > now) await planBookingMessages(tdb, salon, b, new Date(now.getTime() - DAY_MS), { confirmation: false });
    return b;
  };
  await book("Gbenga Ali", "Tunde", "Haircut", at(0, 9, 30), "COMPLETED", 300_000);
  await book("Uche Nwosu", "Chidi", "Haircut + Beard", at(0, 8, 30), "COMPLETED", 250_000); // part-paid (design p8)
  await book("Kola Adeyemi", "Chidi", "Haircut + Beard", at(0, 10, 30), "IN_PROGRESS");
  await book("Chuka Obi", "Tunde", "Haircut", at(0, 11, 30), "CONFIRMED");
  await book("Femi Johnson", "Chidi", "Beard trim", at(0, 12, 0), "NO_SHOW");
  await book("Ibrahim Musa", "Tunde", "Kids cut", at(0, 13, 0), "CONFIRMED");
  await book("Yemi Cole", "Tunde", "Haircut + Beard", at(0, 15, 0), "CONFIRMED");
  // "Tomorrow" is the next day Tunde works (Mon to Sat), so these are bookable times, not stray ones.
  const next = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: TZ }).format(at(1, 12, 0)) === "Sun" ? 2 : 1;
  await book("Sola Peters", "Tunde", "Haircut", at(next, 9, 0), "CONFIRMED");
  await book("Hakeem Ade", "Tunde", "Haircut + Beard", at(next, 9, 45), "CONFIRMED");
  await book("Chinedu Eze", "Tunde", "Haircut", at(next, 11, 0), "CONFIRMED");
  await book("Lekan Dada", "Chidi", "Haircut", at(next, 11, 0), "CONFIRMED");
  await book("Gbenga Ali", "Tunde", "Beard trim", at(next, 12, 30), "CONFIRMED");
  await book("Hakeem Ade", "Chidi", "Kids cut", at(next, 12, 30), "CONFIRMED");

  // Win-back drafts and birthday messages, as the daily job would make them.
  const jobs = await runDailyJobs({ salonId: SALON_ID, now });
  console.log(`Seeded Sharp & Co.: ${people.length} customers, ${ref - 1000} bookings, ${jobs.winbackDrafts} win-back drafts, ${jobs.birthdays} birthday messages.`);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`Customer booking page → ${appUrl}/sharpandco`);
  console.log(`Staff login → ${appUrl}/login  (owner@sharpandco.test / ${PASSWORD})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
