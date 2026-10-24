// Which staff pages a member may open (docs/permissions.md). Shared by the request proxy, which
// answers a real 404 before rendering, and the in-page guards in ./guards.ts.
import { can, type Capability, type Role } from "@/domain/permissions";
import type { ActingMember } from "@/server/authz";
import { forSalon } from "@/server/db";

export type RecordKind = "customer" | "booking" | "conversation";

type PageRule = { pattern: RegExp; capabilities?: Capability[]; roles?: Role[]; record?: RecordKind };

/** Gated /app pages. Each page also calls the matching requirePage()/requireRecord() itself. */
// Record ids never equal "new": /app/customers/new and /app/bookings/new are create pages, not records.
export const STAFF_PAGE_RULES: PageRule[] = [
  { pattern: /^\/app\/customers\/(?!new\/)([^/]+)\/edit$/, capabilities: ["customers.edit"], record: "customer" },
  { pattern: /^\/app\/customers\/(?!new$)([^/]+)$/, record: "customer" },
  { pattern: /^\/app\/bookings\/(?!new$)([^/]+)$/, record: "booking" },
  { pattern: /^\/app\/whatsapp\/inbox\/([^/]+)$/, record: "conversation" },
  { pattern: /^\/app\/whatsapp\/offers$/, capabilities: ["promotions.approve"] },
  { pattern: /^\/app\/whatsapp\/approve$/, capabilities: ["winback.approve"] },
  { pattern: /^\/app\/whatsapp\/templates$/, capabilities: ["ai.copyAssistant"] },
  { pattern: /^\/app\/whatsapp$/, capabilities: ["messages.viewLog"] },
  { pattern: /^\/app\/reports$/, capabilities: ["reports.view"] },
  // Owners get full settings, barbers their own hours; receptionists have no settings page.
  { pattern: /^\/app\/settings$/, roles: ["owner", "barber"] },
];

export function ruleFor(pathname: string): { rule: PageRule; id?: string } | null {
  for (const rule of STAFF_PAGE_RULES) {
    const m = rule.pattern.exec(pathname);
    if (m) return { rule, id: m[1] ? decodeURIComponent(m[1]) : undefined };
  }
  return null;
}

export function hasAnyCapability(member: ActingMember, capabilities: Capability[]): boolean {
  return capabilities.length === 0 || capabilities.some((c) => can(member.role, c, true));
}

/** True if the record exists in the member's salon and their role may see it (barbers: own clients only). */
export async function recordVisible(member: ActingMember, kind: RecordKind, id: string): Promise<boolean> {
  const db = forSalon(member.salonId);
  const barberId = member.role === "barber" ? (member.barberId ?? "none") : null;
  const found =
    kind === "customer"
      ? await db.customer.findFirst({
          where: { id, anonymisedAt: null, ...(barberId ? { bookings: { some: { barberId } } } : {}) },
          select: { id: true },
        })
      : kind === "booking"
        ? await db.booking.findFirst({ where: { id, ...(barberId ? { barberId } : {}) }, select: { id: true } })
        : barberId
          ? null
          : await db.conversation.findFirst({ where: { id }, select: { id: true } });
  return found !== null;
}

/** Whether `member` may open `pathname`; ungated pages are always allowed. */
export async function staffPageAllowed(member: ActingMember, pathname: string): Promise<boolean> {
  const hit = ruleFor(pathname);
  if (!hit) return true;
  if (hit.rule.capabilities && !hasAnyCapability(member, hit.rule.capabilities)) return false;
  if (hit.rule.roles && !hit.rule.roles.includes(member.role)) return false;
  if (hit.rule.record && hit.id) return recordVisible(member, hit.rule.record, hit.id);
  return true;
}
