// Inbound WhatsApp messages and delivery statuses (BR-R2, BR-R10, US-19, US-28).
// On the shared platform number one phone can be a customer of several salons, so a reply is
// routed to the salon that messaged that phone most recently.
import type { Prisma } from "@/generated/prisma/client";
import { setConsent } from "@/server/consent";
import { forSalon, unscopedDb } from "@/server/db";

export type Keyword = "STOP" | "STOP ALL" | "START";

/** BR-R2 keywords. Matching is on the whole message, so "please stop by later" is not an opt-out. */
export function detectKeyword(text: string): Keyword | null {
  const t = text.trim().toUpperCase().replace(/[.!]+$/, "");
  if (t === "STOP ALL") return "STOP ALL";
  if (t === "STOP" || t === "UNSUBSCRIBE") return "STOP";
  if (t === "START" || t === "SUBSCRIBE") return "START";
  return null;
}

export async function routeToSalon(phoneE164: string): Promise<string | null> {
  const db = unscopedDb();
  const recent = await db.message.findFirst({
    where: { customer: { phoneE164 }, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    select: { salonId: true },
  });
  if (recent) return recent.salonId;
  const customers = await db.customer.findMany({ where: { phoneE164 }, select: { salonId: true } });
  const salons = [...new Set(customers.map((c) => c.salonId))];
  return salons.length === 1 ? salons[0] : null;
}

export type Inbound = { fromE164: string; text: string; providerMessageId: string; receivedAt: Date; salonId?: string };

export async function handleInbound(msg: Inbound): Promise<{ salonId: string; keyword: Keyword | null } | null> {
  const salonId = msg.salonId ?? (await routeToSalon(msg.fromE164));
  if (!salonId) return null; // unknown number on the shared line; nothing to attach it to
  const db = forSalon(salonId);
  const keyword = detectKeyword(msg.text);

  const duplicate = await db.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { phoneE164: msg.fromE164 } });
    const conversation = await tx.conversation.upsert({
      where: { salonId_phoneE164: { salonId, phoneE164: msg.fromE164 } },
      create: { salonId, phoneE164: msg.fromE164, customerId: customer?.id ?? null },
      update: {},
    });
    const { count } = await tx.inboundMessage.createMany({
      data: [
        {
          salonId,
          conversationId: conversation.id,
          providerMessageId: msg.providerMessageId,
          text: msg.text,
          keyword,
          receivedAt: msg.receivedAt,
        },
      ],
      skipDuplicates: true, // providers retry webhooks
    });
    if (count === 0) return true;

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: msg.receivedAt,
        // Keyword messages are handled automatically and don't need a staff reply.
        ...(keyword ? {} : { unreadCount: { increment: 1 }, status: "OPEN" }),
        customerId: conversation.customerId ?? customer?.id ?? null,
      },
    });

    if (customer && keyword) {
      const base = { salonId, customerId: customer.id, source: "INBOUND_KEYWORD" as const, wording: `Customer replied "${msg.text.trim()}"` };
      if (keyword === "START") {
        await setConsent(tx, { ...base, purpose: "MARKETING", granted: true });
      } else {
        await setConsent(tx, { ...base, purpose: "MARKETING", granted: false });
        if (keyword === "STOP ALL") await setConsent(tx, { ...base, purpose: "UTILITY", granted: false });
      }
      const text =
        keyword === "START"
          ? "You're opted back in. Reply STOP at any time to stop offers."
          : keyword === "STOP ALL"
            ? "You won't receive any more messages from us."
            : "You won't receive offers any more. Booking reminders will still arrive. Reply START to opt back in.";
      await tx.message.create({
        data: {
          salonId,
          customerId: customer.id,
          type: "OPTOUT_CONFIRMATION",
          renderedText: text,
          status: "QUEUED",
          idempotencyKey: `${salonId}:OPTOUT_CONFIRMATION:${msg.providerMessageId}`,
          scheduledFor: msg.receivedAt,
        },
      });
    }
    return false;
  });
  if (duplicate) return { salonId, keyword: null };
  return { salonId, keyword };
}

const STATUS_ORDER = { SENT: 1, DELIVERED: 2, READ: 3 } as const;

/** Delivery receipts. Statuses only move forward (a late "delivered" never undoes "read"). */
export async function applyStatus(providerMessageId: string, status: "sent" | "delivered" | "read" | "failed", at: Date, reason?: string) {
  const db = unscopedDb();
  const m = await db.message.findUnique({ where: { providerMessageId } });
  if (!m) return false;
  if (status === "failed") {
    await db.message.update({ where: { id: m.id }, data: { status: "FAILED", failureReason: reason ?? "provider_failed" } });
    return true;
  }
  const next = status.toUpperCase() as keyof typeof STATUS_ORDER;
  const current = STATUS_ORDER[m.status as keyof typeof STATUS_ORDER] ?? 0;
  if (STATUS_ORDER[next] <= current) return false;
  const data: Prisma.MessageUpdateInput = { status: next };
  if (next === "DELIVERED") data.deliveredAt = at;
  if (next === "READ") data.readAt = at;
  await db.message.update({ where: { id: m.id }, data });
  return true;
}
