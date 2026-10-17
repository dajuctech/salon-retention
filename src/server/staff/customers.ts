// Customer operations (US-07, US-08, US-18, US-27).
import { STAFF_MARKETING_WORDING, STAFF_UTILITY_WORDING } from "@/domain/consent-wording";
import { normalizePhone } from "@/domain/phone";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import { setConsent } from "@/server/consent";
import { anonymiseCustomerRecord, findOrCreateCustomer } from "@/server/customers";
import { forSalon } from "@/server/db";
import { recomputeCustomerStats } from "./bookings";
import { fail, ok, staffAudit, type StaffCtx } from "./context";

export type CustomerInput = {
  name: string;
  phone: string;
  email?: string;
  birthMonth?: number | null;
  birthDay?: number | null;
  preferredBarberId?: string | null;
  preferredStyle?: string;
  notes?: string;
};

function validBirthday(m?: number | null, d?: number | null): boolean {
  if (m == null && d == null) return true;
  if (!m || !d || m < 1 || m > 12 || d < 1) return false;
  return d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** US-07 / US-08 AC1: a phone that already exists returns the existing customer. */
export async function createCustomer(ctx: StaffCtx, input: CustomerInput & { utilityConsent?: boolean; marketingConsent?: boolean }) {
  assertCan(ctx.member, "customers.edit");
  const phone = normalizePhone(input.phone, ctx.salon.countryCode);
  if (!phone.ok) return fail("That phone number isn't valid.");
  if (input.name.trim().length < 2) return fail("Enter the customer's name.");
  if (!validBirthday(input.birthMonth, input.birthDay)) return fail("That birthday isn't a real date.");
  const db = forSalon(ctx.member.salonId);
  return db.$transaction(async (tx) => {
    const { customer, created } = await findOrCreateCustomer(tx, ctx.member.salonId, { name: input.name, phoneE164: phone.e164 });
    if (created) {
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          email: input.email?.trim() || null,
          birthMonth: input.birthMonth ?? null,
          birthDay: input.birthDay ?? null,
          preferredBarberId: input.preferredBarberId || null,
          preferredStyle: input.preferredStyle?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });
      const base = { salonId: ctx.member.salonId, customerId: customer.id, granted: true, source: "STAFF_VERBAL" as const, actorId: ctx.member.userId };
      if (input.utilityConsent) await setConsent(tx, { ...base, purpose: "UTILITY", wording: STAFF_UTILITY_WORDING });
      if (input.marketingConsent) await setConsent(tx, { ...base, purpose: "MARKETING", wording: STAFF_MARKETING_WORDING });
      await audit(tx, { ...staffAudit(ctx), action: "customer.created", entityType: "Customer", entityId: customer.id });
    }
    return { ok: true as const, value: { id: customer.id, existing: !created } };
  });
}

export async function updateCustomer(ctx: StaffCtx, id: string, input: CustomerInput) {
  assertCan(ctx.member, "customers.edit");
  const db = forSalon(ctx.member.salonId);
  const current = await db.customer.findFirst({ where: { id, anonymisedAt: null } });
  if (!current) return fail("Customer not found.");
  const phone = normalizePhone(input.phone, ctx.salon.countryCode);
  if (!phone.ok) return fail("That phone number isn't valid.");
  if (input.name.trim().length < 2) return fail("Enter the customer's name.");
  if (!validBirthday(input.birthMonth, input.birthDay)) return fail("That birthday isn't a real date.");
  if (phone.e164 !== current.phoneE164 && (await db.customer.findFirst({ where: { phoneE164: phone.e164 } }))) {
    return fail("Another customer already has this number. Merge the two customers instead.");
  }
  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id },
      data: {
        name: input.name.trim(),
        phoneE164: phone.e164,
        // A corrected number gets another chance on WhatsApp ("Fix number", BR-R9).
        ...(phone.e164 !== current.phoneE164 ? { phoneInvalid: false } : {}),
        email: input.email?.trim() || null,
        birthMonth: input.birthMonth ?? null,
        birthDay: input.birthDay ?? null,
        preferredBarberId: input.preferredBarberId || null,
        preferredStyle: input.preferredStyle?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    await audit(tx, {
      ...staffAudit(ctx),
      action: "customer.updated",
      entityType: "Customer",
      entityId: id,
      ...(phone.e164 !== current.phoneE164 ? { before: { phone: "changed" } } : {}),
    });
  });
  return ok;
}

/** US-18 / BR-R1: staff record a customer's verbal consent or withdrawal. */
export async function setCustomerConsent(ctx: StaffCtx, id: string, purpose: "UTILITY" | "MARKETING", granted: boolean) {
  assertCan(ctx.member, "consent.edit");
  const db = forSalon(ctx.member.salonId);
  const customer = await db.customer.findFirst({ where: { id, anonymisedAt: null } });
  if (!customer) return fail("Customer not found.");
  await db.$transaction(async (tx) => {
    const wording = granted
      ? purpose === "UTILITY"
        ? STAFF_UTILITY_WORDING
        : STAFF_MARKETING_WORDING
      : `Customer asked staff to stop ${purpose === "UTILITY" ? "booking reminders" : "offers and return reminders"}.`;
    const changed = await setConsent(tx, { salonId: ctx.member.salonId, customerId: id, purpose, granted, source: "STAFF_EDIT", wording, actorId: ctx.member.userId });
    if (changed) {
      await audit(tx, { ...staffAudit(ctx), action: granted ? "consent.granted" : "consent.revoked", entityType: "Customer", entityId: id, after: { purpose } });
    }
  });
  return ok;
}

/** US-08 AC2: move everything onto `keepId` and remove the duplicate. */
export async function mergeCustomers(ctx: StaffCtx, keepId: string, dropId: string) {
  assertCan(ctx.member, "customers.merge");
  if (keepId === dropId) return fail("Choose two different customers.");
  const db = forSalon(ctx.member.salonId);
  const [keep, drop] = await Promise.all([
    db.customer.findFirst({ where: { id: keepId, anonymisedAt: null }, include: { conversation: true } }),
    db.customer.findFirst({ where: { id: dropId, anonymisedAt: null }, include: { conversation: true } }),
  ]);
  if (!keep || !drop) return fail("Customer not found.");
  await db.$transaction(async (tx) => {
    for (const model of ["booking", "consent", "message", "loyaltyRedemption"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx[model] as any).updateMany({ where: { customerId: dropId }, data: { customerId: keepId } });
    }
    if (drop.conversation) {
      if (keep.conversation) {
        await tx.inboundMessage.updateMany({ where: { conversationId: drop.conversation.id }, data: { conversationId: keep.conversation.id } });
        await tx.conversation.delete({ where: { id: drop.conversation.id } });
      } else {
        await tx.conversation.update({ where: { id: drop.conversation.id }, data: { customerId: keepId } });
      }
    }
    await tx.customer.update({
      where: { id: keepId },
      data: {
        utilityConsent: keep.utilityConsent || drop.utilityConsent,
        marketingConsent: keep.marketingConsent,
        birthMonth: keep.birthMonth ?? drop.birthMonth,
        birthDay: keep.birthDay ?? drop.birthDay,
        notes: [keep.notes, drop.notes].filter(Boolean).join("\n") || null,
      },
    });
    await tx.customer.delete({ where: { id: dropId } });
    await recomputeCustomerStats(tx, keepId);
    await audit(tx, { ...staffAudit(ctx), action: "customer.merged", entityType: "Customer", entityId: keepId, after: { mergedFrom: dropId } });
  });
  return ok;
}

/** US-27 AC1: everything we hold about a customer, as JSON. Owner only. */
export async function exportCustomer(ctx: StaffCtx, id: string) {
  assertCan(ctx.member, "customers.exportDelete");
  const db = forSalon(ctx.member.salonId);
  const customer = await db.customer.findFirst({
    where: { id },
    include: {
      bookings: { include: { service: { select: { name: true } }, payments: true } },
      consents: true,
      messages: { select: { type: true, status: true, renderedText: true, sentAt: true, createdAt: true } },
      conversation: { include: { inbound: { select: { text: true, receivedAt: true } } } },
    },
  });
  if (!customer) return fail("Customer not found.");
  await db.auditLog.create({ data: { ...staffAudit(ctx), action: "customer.exported", entityType: "Customer", entityId: id } });
  return { ok: true as const, value: { exportedAt: new Date().toISOString(), salon: ctx.salon.name, customer } };
}

/**
 * US-27 AC2: remove personal data. Bookings and payments stay for financial records, linked to an
 * anonymous customer; message text and inbound messages are deleted.
 */
export async function anonymiseCustomer(ctx: StaffCtx, id: string) {
  assertCan(ctx.member, "customers.exportDelete");
  const db = forSalon(ctx.member.salonId);
  const customer = await db.customer.findFirst({ where: { id, anonymisedAt: null } });
  if (!customer) return fail("Customer not found.");
  await db.$transaction(async (tx) => {
    await anonymiseCustomerRecord(tx, id, new Date());
    await audit(tx, { ...staffAudit(ctx), action: "customer.anonymised", entityType: "Customer", entityId: id });
  });
  return ok;
}
