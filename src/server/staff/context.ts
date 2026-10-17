// What every staff operation receives. Built from the session by requireStaff(); integration
// tests build it directly. Operations never trust a salonId from the client.
import type { ActingMember } from "@/server/authz";
import type { PublicSalon } from "@/server/db";

export type StaffCtx = { member: ActingMember; salon: PublicSalon; user: { id: string; name: string } };

export const ok = { ok: true } as const;
export const fail = (message: string) => ({ ok: false as const, message });

export function staffAudit(ctx: StaffCtx) {
  return { salonId: ctx.member.salonId, actorId: ctx.member.userId, actorType: "staff" as const };
}
