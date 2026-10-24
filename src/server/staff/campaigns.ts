// Offer campaigns (PRD §7 flow 5, BR-PR1–PR3): send an offer to a customer group.
// The owner previews who gets it, who is excluded and why, and the estimated cost, then approves.
// Messages go through the normal queue, so consent, quiet hours and the frequency cap are
// re-checked at send time.
import { checkDraft } from "@/domain/ai-guardrails";
import { firstName } from "@/domain/format";
import { estimateCostUsd, frequencyCapAllows } from "@/domain/messaging-rules";
import { isPromotionActive, offerLine } from "@/domain/offers";
import { renderTemplate, templateFor } from "@/domain/templates";
import { localDateKey } from "@/domain/time";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import { forSalon } from "@/server/db";
import { dispatchDue } from "@/server/platform/dispatcher";
import { bookingPageUrl, enqueue } from "@/server/messaging/queue";
import { fail, staffAudit, type StaffCtx } from "./context";
import { recordAIOutcome } from "./copy-assistant";
import { customersList, type SegmentFilter } from "./queries/customers";

export const CAMPAIGN_SEGMENTS: { key: SegmentFilter | "inactive" | "loyal"; label: string }[] = [
  { key: "all", label: "Everyone who agreed to offers" },
  { key: "due", label: "Due to return" },
  { key: "inactive", label: "Haven't visited in 45+ days" },
  { key: "loyal", label: "Loyal (5+ visits in 6 months)" },
  { key: "new", label: "New customers" },
];
export type CampaignSegment = (typeof CAMPAIGN_SEGMENTS)[number]["key"];

const MAX_WORDING = 300;
const DAY_MS = 86_400_000;

/** Turns the owner's wording into the text for one customer. The booking link is added by the template. */
export function personalise(wording: string, v: { first_name: string; salon_name: string; offer: string }): string {
  return wording
    .replace(/\{\{\s*first_name\s*\}\}/g, v.first_name)
    .replace(/\{\{\s*salon_name\s*\}\}/g, v.salon_name)
    .replace(/\{\{\s*offer\s*\}\}/g, v.offer)
    .replace(/\s+/g, " ")
    .trim();
}

export function checkWording(wording: string): string | null {
  const w = wording.trim();
  if (!w) return "Write the message first.";
  if (/\{\{\s*booking_link\s*\}\}/.test(w)) return "Leave out {{booking_link}}; the booking link is added after your message.";
  const r = checkDraft(w, { maxLength: MAX_WORDING, promotionProvided: true, requireBookingLink: false });
  if (r.ok) return null;
  const v = r.violations[0];
  if (v.startsWith("unknown_placeholder")) return `Only {{first_name}}, {{salon_name}} and {{offer}} can be used here.`;
  return (
    ({
      literal_offer: "Don't type the discount; use {{offer}} so it always matches the offer.",
      too_long: `Keep it under ${MAX_WORDING} characters.`,
      blocked_term: "Please avoid pressure words and health claims.",
      contains_optout_footer: "The opt-out line is added automatically.",
      malformed_placeholder: "A placeholder is missing its double braces, like {{first_name}}.",
    } as Record<string, string>)[v] ?? "That wording breaks the message rules."
  );
}

async function audience(ctx: StaffCtx, segment: CampaignSegment, now: Date) {
  const db = forSalon(ctx.member.salonId);
  // Segment rules are the same deterministic ones the Customers screen uses (business-rules §6).
  const listFilter: SegmentFilter = segment === "inactive" || segment === "loyal" ? "all" : segment;
  const list = await customersList(ctx, undefined, listFilter, 100_000, now);
  const ids = list.rows.filter((r) => (segment === "inactive" || segment === "loyal" ? r.segments.includes(segment) : true)).map((r) => r.id);
  const customers = await db.customer.findMany({ where: { id: { in: ids } } });
  const recentMarketing = await db.message.findMany({
    where: {
      customerId: { in: ids },
      type: { in: ["WINBACK", "BIRTHDAY", "PROMOTION"] },
      status: { in: ["SENT", "DELIVERED", "READ", "QUEUED"] },
      createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
    },
    select: { customerId: true, sentAt: true, createdAt: true },
  });
  const byCustomer = new Map<string, Date[]>();
  for (const m of recentMarketing) {
    const list2 = byCustomer.get(m.customerId) ?? [];
    list2.push(m.sentAt ?? m.createdAt);
    byCustomer.set(m.customerId, list2);
  }
  const recipients: typeof customers = [];
  const excluded = { noConsent: 0, capped: 0, holdout: 0, badNumber: 0 };
  for (const c of customers) {
    if (!c.marketingConsent) excluded.noConsent++;
    else if (c.phoneInvalid) excluded.badNumber++;
    else if (c.holdout) excluded.holdout++;
    else if (!frequencyCapAllows(byCustomer.get(c.id) ?? [], now, ctx.salon.marketingCapPerWeek)) excluded.capped++;
    else recipients.push(c);
  }
  return { recipients, excluded, total: customers.length };
}

async function activePromotion(ctx: StaffCtx, promotionId: string, now: Date) {
  const db = forSalon(ctx.member.salonId);
  const p = await db.promotion.findFirst({ where: { id: promotionId, isBirthday: false } });
  if (!p || !isPromotionActive(p, localDateKey(now, ctx.salon.timezone))) return null;
  const services = await db.service.findMany({ where: { id: { in: p.serviceIds } }, select: { name: true } });
  return { ...p, line: offerLine({ kind: p.kind, value: p.value, serviceNames: services.map((s) => s.name), endsOn: p.endsOn }, ctx.salon.currency) };
}

/** The offer wording for a running offer, or null (used by the AI wording assistant). */
export async function runningOfferLine(ctx: StaffCtx, promotionId: string, now = new Date()): Promise<string | null> {
  assertCan(ctx.member, "promotions.approve");
  return (await activePromotion(ctx, promotionId, now))?.line ?? null;
}

export async function previewCampaign(ctx: StaffCtx, input: { promotionId: string; segment: CampaignSegment; wording: string }, now = new Date()) {
  assertCan(ctx.member, "promotions.approve");
  const promo = await activePromotion(ctx, input.promotionId, now);
  if (!promo) return fail("Choose an offer that is running today.");
  const wordingError = checkWording(input.wording);
  const { recipients, excluded, total } = await audience(ctx, input.segment, now);
  const sample = recipients[0];
  return {
    ok: true as const,
    value: {
      total,
      recipients: recipients.length,
      excluded,
      costUsd: estimateCostUsd(recipients.length, "marketing", ctx.salon.countryCode),
      wordingError,
      preview: wordingError
        ? null
        : renderTemplate(templateFor("PROMOTION")!.body, [
            ctx.salon.name,
            personalise(input.wording, { first_name: sample ? firstName(sample.name) : "Segun", salon_name: ctx.salon.name, offer: promo.line }),
            bookingPageUrl(ctx.salon.slug),
          ]),
    },
  };
}

export async function sendCampaign(
  ctx: StaffCtx,
  input: { promotionId: string; segment: CampaignSegment; wording: string; generationId?: string; pickedDraft?: string },
  now = new Date(),
) {
  assertCan(ctx.member, "promotions.approve");
  const promo = await activePromotion(ctx, input.promotionId, now);
  if (!promo) return fail("Choose an offer that is running today.");
  const wordingError = checkWording(input.wording);
  if (wordingError) return fail(wordingError);
  const { recipients, excluded } = await audience(ctx, input.segment, now);
  if (recipients.length === 0) return fail("Nobody in this group can receive offers right now.");

  const db = forSalon(ctx.member.salonId);
  let queued = 0;
  for (const c of recipients) {
    const body = personalise(input.wording, { first_name: firstName(c.name), salon_name: ctx.salon.name, offer: promo.line });
    const result = await enqueue(db, ctx.salon, {
      type: "PROMOTION",
      customerId: c.id,
      promotionId: promo.id,
      values: { salon_name: ctx.salon.name, promotion_body: body, booking_link: bookingPageUrl(ctx.salon.slug) },
      scheduledFor: now,
      // One send of the same offer per customer per day, even if the owner presses twice.
      subjectId: `${c.id}@${promo.id}`,
    });
    if (result === "created") queued++;
  }
  await db.message.updateMany({
    where: { type: "PROMOTION", promotionId: promo.id, status: "QUEUED", approvedById: null },
    data: { approvedById: ctx.member.userId, approvedAt: now },
  });
  await audit(db, {
    ...staffAudit(ctx),
    action: "campaign.sent",
    entityType: "Promotion",
    entityId: promo.id,
    after: { segment: input.segment, queued, excluded },
  });
  // Wording drafted with AI: record what the owner picked and what they approved.
  await recordAIOutcome(ctx, { generationId: input.generationId, pickedDraft: input.pickedDraft, finalText: input.wording });
  await dispatchDue({ salonId: ctx.member.salonId, now, limit: 500 });
  return { ok: true as const, value: { queued, duplicates: recipients.length - queued } };
}
