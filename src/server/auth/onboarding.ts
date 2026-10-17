// Salon sign-up (US-01, US-02) and accepting staff invitations (US-03).
import { COUNTRIES, STARTER_SERVICES, starterPrice } from "@/domain/countries";
import { toMinor } from "@/domain/money";
import { uniqueSlug } from "@/domain/slug";
import type { MemberRole } from "@/generated/prisma/client";
import { unscopedDb } from "@/server/db";
import { hashToken } from "@/server/links";

const h = (hh: number) => hh * 60;

export async function createSalonForOwner(
  user: { id: string; name: string },
  input: { salonName: string; country: string; alsoBarber: boolean },
): Promise<{ salonId: string; slug: string }> {
  const country = COUNTRIES[input.country];
  if (!country) throw new Error("Unsupported country");
  const db = unscopedDb();
  const slug = await uniqueSlug(input.salonName, async (s) => Boolean(await db.salon.findUnique({ where: { slug: s } })));

  return db.$transaction(async (tx) => {
    const salon = await tx.salon.create({
      data: {
        id: crypto.randomUUID(),
        name: input.salonName.trim(),
        slug,
        countryCode: input.country,
        timezone: country.timezone,
        currency: country.currency,
        slotGridMinutes: 30,
        // US-02 starting hours: Mon–Sat 09:00–19:00; owners adjust in Settings.
        openingHours: { create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: h(9), endMin: h(19) })) },
        services: {
          create: STARTER_SERVICES.map((s, i) => ({
            name: s.name,
            durationMin: s.durationMin,
            priceMinor: toMinor(starterPrice(country.currency, i), country.currency),
            currency: country.currency,
            sortOrder: i,
            loyaltyReward: s.loyaltyReward ?? false,
          })),
        },
      },
    });
    const member = await tx.member.create({ data: { salonId: salon.id, userId: user.id, role: "owner" } });
    if (input.alsoBarber) {
      await tx.barber.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          displayName: user.name.split(" ")[0],
          workingHours: {
            create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ salonId: salon.id, weekday, startMin: h(9), endMin: h(19) })),
          },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        salonId: salon.id,
        actorId: user.id,
        actorType: "staff",
        action: "salon.created",
        entityType: "Salon",
        entityId: salon.id,
      },
    });
    return { salonId: salon.id, slug };
  });
}

export async function findInvitation(token: string) {
  const inv = await unscopedDb().invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { salon: true, inviter: { select: { name: true } } },
  });
  if (!inv || inv.status !== "PENDING" || inv.expiresAt < new Date()) return null;
  return inv;
}

export type AcceptResult = { ok: true; salonId: string } | { ok: false; message: string };

/** The signed-in user must own the invited email address. */
export async function acceptInvitation(token: string, user: { id: string; name: string; email: string }): Promise<AcceptResult> {
  const inv = await findInvitation(token);
  if (!inv) return { ok: false, message: "This invitation has expired or was already used." };
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, message: `This invitation is for ${inv.email}. Sign in with that email to accept it.` };
  }
  const db = unscopedDb();
  await db.$transaction(async (tx) => {
    const existing = await tx.member.findUnique({ where: { salonId_userId: { salonId: inv.salonId, userId: user.id } } });
    const member = existing
      ? await tx.member.update({ where: { id: existing.id }, data: { role: inv.role as MemberRole, active: true } })
      : await tx.member.create({ data: { salonId: inv.salonId, userId: user.id, role: inv.role as MemberRole } });
    if (inv.role === "barber") {
      const linked = inv.barberId
        ? await tx.barber.findFirst({ where: { id: inv.barberId, salonId: inv.salonId, memberId: null } })
        : null;
      if (linked) {
        await tx.barber.update({ where: { id: linked.id }, data: { memberId: member.id } });
      } else if (!(await tx.barber.findUnique({ where: { memberId: member.id } }))) {
        await tx.barber.create({ data: { salonId: inv.salonId, memberId: member.id, displayName: user.name.split(" ")[0] } });
      }
    }
    await tx.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED" } });
    await tx.auditLog.create({
      data: {
        salonId: inv.salonId,
        actorId: user.id,
        actorType: "staff",
        action: "staff.invitation_accepted",
        entityType: "Member",
        entityId: member.id,
        after: { role: inv.role },
      },
    });
  });
  return { ok: true, salonId: inv.salonId };
}
