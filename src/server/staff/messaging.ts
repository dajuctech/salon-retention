// Staff messaging (US-21–US-24, US-28): win-back approval queue, inbox, automatic-message settings.
import { STAFF_UTILITY_WORDING } from "@/domain/consent-wording";
import { isPromotionActive, offerLine } from "@/domain/offers";
import { renderTemplate, templateParams } from "@/domain/templates";
import { localDateKey } from "@/domain/time";
import { audit, type DbLike } from "@/server/audit";
import { assertCan } from "@/server/authz";
import { setConsent } from "@/server/consent";
import { findOrCreateCustomer } from "@/server/customers";
import { forSalon } from "@/server/db";
import { approvedTemplate } from "@/server/messaging/queue";
import { winbackValues } from "@/server/platform/daily";
import { dispatchDue, dispatchOne } from "@/server/platform/dispatcher";
import { handleInbound } from "@/server/platform/inbound";
import { fail, ok, staffAudit, type StaffCtx } from "./context";

export type Variant = "friendly" | "short" | "with_offer";
const SESSION_WINDOW_MS = 24 * 3600_000;

/** The salon's current non-birthday offer, if any (BR-PR2: offer text only from a Promotion). */
export async function activeOffer(db: DbLike, salon: StaffCtx["salon"], now = new Date()) {
  const today = localDateKey(now, salon.timezone);
  const promos = await db.promotion.findMany({ where: { active: true, isBirthday: false }, orderBy: { createdAt: "desc" } });
  const promo = promos.find((p) => isPromotionActive(p, today));
  if (!promo) return null;
  const services = await db.service.findMany({ where: { id: { in: promo.serviceIds } }, select: { name: true } });
  return {
    id: promo.id,
    name: promo.name,
    line: offerLine({ kind: promo.kind, value: promo.value, serviceNames: services.map((s) => s.name), endsOn: promo.endsOn }, salon.currency),
  };
}

/** Re-renders a win-back draft for a variant with fresh values (weeks since visit move on). */
async function renderDraft(db: DbLike, ctx: StaffCtx, messageId: string, variant: Variant, now: Date) {
  const m = await db.message.findFirst({ where: { id: messageId, type: "WINBACK", status: "DRAFT" }, include: { customer: true } });
  if (!m || !m.customer.lastVisitAt) return fail("This draft is no longer available.");
  const template = await approvedTemplate(db, "WINBACK", variant);
  if (!template) return fail("That message version isn't approved yet.");
  let offer: Awaited<ReturnType<typeof activeOffer>> = null;
  if (variant === "with_offer") {
    offer = await activeOffer(db, ctx.salon, now);
    if (!offer) return fail("Create an offer in Settings first. Offers are never written into messages by hand.");
  }
  const previous = (m.variables ?? {}) as Record<string, string>;
  const values = winbackValues(ctx.salon, { name: m.customer.name, lastVisitAt: m.customer.lastVisitAt }, previous.barber_name ?? "us", now, offer?.line);
  const renderedText = renderTemplate(template.body, templateParams(template.variables, values));
  await db.message.update({
    where: { id: m.id },
    data: { templateId: template.id, variables: values, renderedText, promotionId: offer?.id ?? null },
  });
  return ok;
}

export async function setDraftVariant(ctx: StaffCtx, messageId: string, variant: Variant, now = new Date()) {
  assertCan(ctx.member, "winback.approve");
  return renderDraft(forSalon(ctx.member.salonId), ctx, messageId, variant, now);
}

/**
 * US-22 AC3/AC4: approve one, several or all drafts. Each is re-checked first (BR-R3c): a customer
 * who booked, opted out or was deleted since the draft was made is skipped with the reason.
 */
export async function approveDrafts(ctx: StaffCtx, ids: string[] | "all", sendAt?: Date, now = new Date()) {
  assertCan(ctx.member, "winback.approve");
  const db = forSalon(ctx.member.salonId);
  const drafts = await db.message.findMany({
    where: { type: "WINBACK", status: "DRAFT", ...(ids === "all" ? {} : { id: { in: ids } }) },
    include: { customer: true, template: true },
  });
  let queued = 0;
  let skipped = 0;
  for (const d of drafts) {
    const upcoming = await db.booking.findFirst({
      where: { customerId: d.customerId, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } },
    });
    const reason = d.customer.anonymisedAt
      ? "customer_deleted"
      : !d.customer.marketingConsent
        ? "no_consent"
        : upcoming
          ? "booked_since"
          : null;
    if (reason) {
      await db.message.update({ where: { id: d.id }, data: { status: "SKIPPED", skipReason: reason } });
      skipped++;
      continue;
    }
    const variant = (d.template?.variant ?? "friendly") as Variant;
    const rendered = await renderDraft(db, ctx, d.id, variant, now);
    if (!rendered.ok) {
      skipped++;
      continue;
    }
    await db.message.update({
      where: { id: d.id },
      data: { status: "QUEUED", scheduledFor: sendAt && sendAt > now ? sendAt : now, approvedById: ctx.member.userId, approvedAt: now },
    });
    queued++;
  }
  await audit(db, { ...staffAudit(ctx), action: "winback.approved", entityType: "Message", entityId: ids === "all" ? "all" : ids.join(","), after: { queued, skipped } });
  // Send straight away rather than waiting for the next cron run (quiet hours still apply).
  if (queued && !sendAt) await dispatchDue({ salonId: ctx.member.salonId, now });
  return { ok: true as const, value: { queued, skipped } };
}

export async function skipDraft(ctx: StaffCtx, messageId: string) {
  assertCan(ctx.member, "winback.approve");
  const db = forSalon(ctx.member.salonId);
  const { count } = await db.message.updateMany({
    where: { id: messageId, type: "WINBACK", status: "DRAFT" },
    data: { status: "SKIPPED", skipReason: "owner_skipped" },
  });
  return count ? ok : fail("This draft is no longer available.");
}

/** US-24 AC2: try a failed message again (after fixing the number, for example). */
export async function retryMessage(ctx: StaffCtx, messageId: string) {
  assertCan(ctx.member, "messages.viewLog");
  const db = forSalon(ctx.member.salonId);
  const { count } = await db.message.updateMany({
    where: { id: messageId, status: "FAILED" },
    data: { status: "QUEUED", attempts: 0, nextAttemptAt: null, failureReason: null, scheduledFor: new Date() },
  });
  if (!count) return fail("Only failed messages can be retried.");
  const outcome = await dispatchOne(messageId);
  return outcome === "sent" ? ok : fail("It didn't send. Check the number and try again later.");
}

export async function updateAutoMessages(
  ctx: StaffCtx,
  settings: { dayBeforeReminderOn: boolean; shortReminderOn: boolean; birthdayMessageOn: boolean; winbackOn: boolean },
) {
  assertCan(ctx.member, "messaging.settings");
  const db = forSalon(ctx.member.salonId);
  await db.$transaction(async (tx) => {
    await tx.salon.update({ where: { id: ctx.member.salonId }, data: settings });
    await audit(tx, { ...staffAudit(ctx), action: "messaging.settings_changed", entityType: "Salon", entityId: ctx.member.salonId, after: settings });
  });
  return ok;
}

/**
 * Emergency stop for this salon (operations.md runbook, UI plan §4 "Messaging paused"). Nothing is
 * sent while paused; messages stay queued and go out once sending resumes (stale ones are skipped
 * by the usual send-time checks).
 */
export async function setMessagingPaused(ctx: StaffCtx, paused: boolean) {
  assertCan(ctx.member, "messaging.settings");
  const db = forSalon(ctx.member.salonId);
  await db.$transaction(async (tx) => {
    await tx.salon.update({ where: { id: ctx.member.salonId }, data: { messagingPaused: paused } });
    await audit(tx, { ...staffAudit(ctx), action: paused ? "messaging.paused" : "messaging.resumed", entityType: "Salon", entityId: ctx.member.salonId });
  });
  return ok;
}

// ───────── Inbox (US-28, BR-R10) ─────────

export async function openConversation(ctx: StaffCtx, conversationId: string) {
  assertCan(ctx.member, "inbox.use");
  await forSalon(ctx.member.salonId).conversation.updateMany({ where: { id: conversationId }, data: { unreadCount: 0 } });
}

export async function markHandled(ctx: StaffCtx, conversationId: string) {
  assertCan(ctx.member, "inbox.use");
  const { count } = await forSalon(ctx.member.salonId).conversation.updateMany({
    where: { id: conversationId },
    data: { status: "HANDLED", unreadCount: 0 },
  });
  return count ? ok : fail("Conversation not found.");
}

export async function replyInConversation(ctx: StaffCtx, conversationId: string, text: string, now = new Date()) {
  assertCan(ctx.member, "inbox.use");
  const body = text.trim();
  if (!body) return fail("Write a reply first.");
  if (body.length > 1000) return fail("Keep replies under 1,000 characters.");
  const db = forSalon(ctx.member.salonId);
  const c = await db.conversation.findFirst({ where: { id: conversationId } });
  if (!c) return fail("Conversation not found.");
  if (!c.customerId) return fail("Create a customer for this number first.");
  if (!c.lastInboundAt || now.getTime() - c.lastInboundAt.getTime() > SESSION_WINDOW_MS) {
    return fail("The 24-hour reply window has closed. WhatsApp only allows approved templates until the customer writes again.");
  }
  const message = await db.message.create({
    data: {
      salonId: ctx.member.salonId,
      customerId: c.customerId,
      type: "STAFF_REPLY",
      renderedText: body,
      status: "QUEUED",
      idempotencyKey: `${ctx.member.salonId}:STAFF_REPLY:${crypto.randomUUID()}`,
      scheduledFor: now,
      approvedById: ctx.member.userId,
    },
  });
  await db.conversation.update({ where: { id: c.id }, data: { unreadCount: 0 } });
  const outcome = await dispatchOne(message.id, now);
  return outcome === "sent" ? ok : fail("The reply didn't send. It's in the message log as failed.");
}

export async function createCustomerFromConversation(ctx: StaffCtx, conversationId: string, name: string) {
  assertCan(ctx.member, "customers.edit");
  if (name.trim().length < 2) return fail("Enter the customer's name.");
  const db = forSalon(ctx.member.salonId);
  const c = await db.conversation.findFirst({ where: { id: conversationId } });
  if (!c) return fail("Conversation not found.");
  if (c.customerId) return ok;
  await db.$transaction(async (tx) => {
    const { customer } = await findOrCreateCustomer(tx, ctx.member.salonId, { name, phoneE164: c.phoneE164 });
    await tx.conversation.update({ where: { id: c.id }, data: { customerId: customer.id } });
    // They wrote to us first; replying about their booking is expected.
    await setConsent(tx, {
      salonId: ctx.member.salonId,
      customerId: customer.id,
      purpose: "UTILITY",
      granted: true,
      source: "STAFF_VERBAL",
      wording: STAFF_UTILITY_WORDING,
      actorId: ctx.member.userId,
    });
    await audit(tx, { ...staffAudit(ctx), action: "customer.created", entityType: "Customer", entityId: customer.id, after: { from: "inbox" } });
  });
  return ok;
}

/** Development only: pretend a customer replied, to try the inbox and STOP handling locally. */
export async function simulateInbound(ctx: StaffCtx, phoneE164: string, text: string) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TOOLS !== "true") return fail("Not available.");
  assertCan(ctx.member, "inbox.use");
  await handleInbound({ fromE164: phoneE164, text, providerMessageId: `sim_${crypto.randomUUID()}`, receivedAt: new Date(), salonId: ctx.member.salonId });
  await dispatchDue({ salonId: ctx.member.salonId });
  return ok;
}
