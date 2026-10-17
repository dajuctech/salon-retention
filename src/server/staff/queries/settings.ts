// Settings screen data — design p12.
import { minorUnitDigits } from "@/domain/money";
import { forSalon } from "@/server/db";
import type { StaffCtx } from "../context";

export async function settingsData(ctx: StaffCtx) {
  const { member, salon } = ctx;
  const db = forSalon(member.salonId);
  const [services, barbers, opening, closed, members, invitations, promotions] = await Promise.all([
    db.service.findMany({ orderBy: { sortOrder: "asc" } }),
    db.barber.findMany({ include: { workingHours: true, member: { include: { user: { select: { email: true } } } } }, orderBy: { sortOrder: "asc" } }),
    db.openingHours.findMany({ orderBy: [{ weekday: "asc" }, { startMin: "asc" }] }),
    db.closedDate.findMany({ orderBy: { date: "asc" } }),
    // Member and Invitation aren't tenant-scoped: filter explicitly.
    db.member.findMany({ where: { salonId: member.salonId }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.invitation.findMany({ where: { salonId: member.salonId, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.promotion.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const unit = 10 ** minorUnitDigits(salon.currency);
  return {
    salon,
    services: services.map((s) => ({ ...s, price: s.priceMinor / unit })),
    barbers: barbers.map((b) => ({
      id: b.id,
      displayName: b.displayName,
      active: b.active,
      hasLogin: Boolean(b.memberId),
      email: b.member?.user.email ?? null,
      hours: b.workingHours.map((h) => ({ weekday: h.weekday, startMin: h.startMin, endMin: h.endMin })),
    })),
    opening: opening.map((o) => ({ weekday: o.weekday, startMin: o.startMin, endMin: o.endMin })),
    closed: closed.map((c) => ({ id: c.id, date: c.date.toISOString().slice(0, 10), reason: c.reason })),
    members: members.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role, active: m.active, self: m.userId === member.userId })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expires: i.expiresAt.toISOString().slice(0, 10) })),
    promotions: promotions.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      value: p.kind === "FIXED" ? p.value / unit : p.value,
      startsOn: p.startsOn.toISOString().slice(0, 10),
      endsOn: p.endsOn.toISOString().slice(0, 10),
      isBirthday: p.isBirthday,
      services: services.filter((s) => p.serviceIds.includes(s.id)).map((s) => s.name),
    })),
  };
}
