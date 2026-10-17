// Customer creation shared by online booking, walk-ins and staff (BR-I2, metrics.md holdout).
import { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "./audit";

/** Share of new customers held out of win-back messages to measure their real effect (metrics.md). */
export function assignHoldout(): boolean {
  const rate = Number(process.env.HOLDOUT_RATE ?? "0.1");
  return Math.random() < (Number.isFinite(rate) ? rate : 0.1);
}

/** Finds the customer by phone or creates them. Existing details are never overwritten here. */
export async function findOrCreateCustomer(
  db: DbLike,
  salonId: string,
  input: { name: string; phoneE164: string },
): Promise<{ customer: Awaited<ReturnType<DbLike["customer"]["create"]>>; created: boolean }> {
  const existing = await db.customer.findFirst({ where: { phoneE164: input.phoneE164 } });
  if (existing) return { customer: existing, created: false };
  const customer = await db.customer.create({
    data: { salonId, name: input.name.trim(), phoneE164: input.phoneE164, holdout: assignHoldout() },
  });
  return { customer, created: true };
}

/**
 * US-27 deletion and the retention job: removes personal data but keeps the anonymous visit and
 * payment history that reports and financial records need (security-privacy.md §Retention).
 */
export async function anonymiseCustomerRecord(tx: DbLike, id: string, now: Date) {
  // Stop anything not yet sent; keep sent/delivered statuses (reports), but remove the text.
  await tx.message.updateMany({
    where: { customerId: id, status: { in: ["QUEUED", "DRAFT"] } },
    data: { status: "SKIPPED", skipReason: "customer_deleted" },
  });
  await tx.message.updateMany({ where: { customerId: id }, data: { renderedText: "[deleted]", whyNow: null, variables: Prisma.DbNull } });
  await tx.conversation.deleteMany({ where: { customerId: id } });
  await tx.customer.update({
    where: { id },
    data: {
      name: "Deleted customer",
      phoneE164: `deleted:${id}`,
      email: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      preferredStyle: null,
      notes: null,
      utilityConsent: false,
      marketingConsent: false,
      anonymisedAt: now,
    },
  });
}
