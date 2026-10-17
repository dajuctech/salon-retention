"use server";

// Staff server actions. Each resolves the session, runs one operation (which checks permissions
// itself) and refreshes the screen. salonId always comes from the session, never the form.
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { BookingStatus } from "@/domain/booking-status";
import { toMinor } from "@/domain/money";
import { normalizePhone } from "@/domain/phone";
import { atLocal } from "@/domain/time";
import { requireStaff } from "@/server/auth/session";
import { ForbiddenError, assertCan } from "@/server/authz";
import { forSalon } from "@/server/db";
import { runDailyJobs } from "@/server/platform/daily";
import { dispatchDue } from "@/server/platform/dispatcher";
import { STAFF_RULES, slotsFor, type SlotOption } from "@/server/slots";
import { changeBookingStatus, createStaffBooking, createWalkIn, rescheduleBookingStaff } from "@/server/staff/bookings";
import type { StaffCtx } from "@/server/staff/context";
import { anonymiseCustomer, createCustomer, mergeCustomers, setCustomerConsent, updateCustomer } from "@/server/staff/customers";
import {
  approveDrafts,
  createCustomerFromConversation,
  markHandled,
  replyInConversation,
  retryMessage,
  setDraftVariant,
  simulateInbound,
  skipDraft,
  updateAutoMessages,
  type Variant,
} from "@/server/staff/messaging";
import { recordPayment, redeemLoyalty, refundPayment } from "@/server/staff/payments";
import {
  addClosedDate,
  addTimeOff,
  endPromotion,
  inviteStaff,
  removeClosedDate,
  revokeInvitation,
  saveBarber,
  saveService,
  savePromotion,
  setMemberAccess,
  setOpeningHours,
  updateBookingRules,
  updateSalonProfile,
  type HoursRange,
} from "@/server/staff/settings";

export type ActionState = { ok?: boolean; error?: string; info?: string; link?: string } | null;
type OpResult = { ok: true; value?: unknown } | { ok: false; message: string };

async function ctx(): Promise<StaffCtx> {
  const s = await requireStaff();
  return { member: s.member, salon: s.salon, user: s.user };
}

async function act(op: (c: StaffCtx) => Promise<OpResult>, success?: string): Promise<ActionState> {
  const c = await ctx();
  try {
    const r = await op(c);
    if (!r.ok) return { error: r.message };
    refresh();
    return { ok: true, info: success };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
    throw err;
  }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const num = (f: FormData, k: string) => Number(f.get(k));

// ───────── Bookings ─────────

export async function bookingStatusAction(bookingId: string, to: BookingStatus, reason?: string): Promise<ActionState> {
  return act((c) => changeBookingStatus(c, bookingId, to, reason), "Booking updated.");
}

export async function staffSlotsAction(serviceId: string, barber: string, dateKey: string, ignoreBookingId?: string): Promise<SlotOption[]> {
  const c = await ctx();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];
  const choice = c.member.role === "barber" ? (c.member.barberId ?? "none") : barber;
  return slotsFor(c.salon, serviceId, choice, dateKey, { rules: STAFF_RULES, ignoreBookingId });
}

export async function createBookingAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const customerId = str(f, "customerId");
  const startsAt = str(f, "startsAt");
  if (!startsAt) return { error: "Pick a time." };
  let createdId: string | null = null;
  const res = await act(async (c) => {
    const r = await createStaffBooking(c, {
      customer: customerId ? { customerId } : { name: str(f, "name"), phone: str(f, "phone") },
      serviceId: str(f, "serviceId"),
      barber: str(f, "barber") || "any",
      startsAt: new Date(startsAt),
      notes: str(f, "notes"),
      utilityConsent: bool(f, "utility"),
      marketingConsent: bool(f, "marketing"),
    });
    if (r.ok) createdId = r.value.id;
    return r;
  });
  if (createdId) redirect(`/app/bookings/${createdId}?created=1`);
  return res;
}

export async function walkInAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const c = await ctx();
  try {
    const r = await createWalkIn(c, {
      customerId: str(f, "customerId") || undefined,
      phone: str(f, "phone"),
      name: str(f, "name") || undefined,
      serviceId: str(f, "serviceId"),
      barber: str(f, "barber") || "any",
      paidNow: bool(f, "paidNow"),
      method: (str(f, "method") || "CASH") as "CASH" | "TRANSFER" | "POS" | "CARD",
      utilityConsent: bool(f, "utility"),
      marketingConsent: bool(f, "marketing"),
    });
    if (!r.ok) return { error: r.message };
    refresh();
    const base = `Saved · ${r.value.customerName.split(" ")[0]} is now in chair with ${r.value.barberName}.`;
    return { ok: true, info: r.value.warning ? `${base} Note: ${r.value.warning}` : base };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
    throw err;
  }
}

export async function rescheduleAction(bookingId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  const startsAt = str(f, "startsAt");
  if (!startsAt) return { error: "Pick a new time." };
  return act((c) => rescheduleBookingStaff(c, bookingId, new Date(startsAt), str(f, "barber") || "any"), "Booking moved. The customer gets an updated confirmation.");
}

/** Walk-in / new booking: find customers as the receptionist types (name, or phone if allowed). */
export async function lookupCustomersAction(query: string): Promise<{ id: string; name: string; detail: string }[]> {
  const c = await ctx();
  const q = query.trim();
  if (q.length < 2) return [];
  const db = forSalon(c.member.salonId);
  const phone = normalizePhone(q, c.salon.countryCode);
  const digits = q.replace(/\D/g, "");
  const canPhone = c.member.role !== "barber";
  const rows = await db.customer.findMany({
    where: {
      anonymisedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(canPhone && phone.ok ? [{ phoneE164: phone.e164 }] : []),
        ...(canPhone && digits.length >= 4 ? [{ phoneE164: { contains: digits.replace(/^0/, "") } }] : []),
      ],
    },
    take: 5,
    orderBy: { lastVisitAt: { sort: "desc", nulls: "last" } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, detail: `${r.visitCount} visit${r.visitCount === 1 ? "" : "s"}` }));
}

// ───────── Payments ─────────

const methodSchema = z.enum(["CASH", "TRANSFER", "POS", "CARD"]);

export async function recordPaymentAction(bookingId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  const method = methodSchema.safeParse(str(f, "method"));
  if (!method.success) return { error: "Choose how they paid." };
  const c = await ctx();
  const amount = num(f, "amount");
  if (!(amount > 0)) return { error: "Enter the amount." };
  return act((cc) => recordPayment(cc, bookingId, { method: method.data, amountMinor: toMinor(amount, c.salon.currency), reference: str(f, "reference") }), "Payment recorded.");
}

export async function refundAction(bookingId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  const c = await ctx();
  return act((cc) => refundPayment(cc, bookingId, toMinor(num(f, "amount"), c.salon.currency), str(f, "reason")), "Refund recorded.");
}

export async function redeemLoyaltyAction(bookingId: string): Promise<ActionState> {
  return act((c) => redeemLoyalty(c, bookingId), "Free cut used. Stamps start again.");
}

// ───────── Customers ─────────

function customerFields(f: FormData) {
  const bm = str(f, "birthMonth");
  const bd = str(f, "birthDay");
  return {
    name: str(f, "name"),
    phone: str(f, "phone"),
    email: str(f, "email"),
    birthMonth: bm ? Number(bm) : null,
    birthDay: bd ? Number(bd) : null,
    preferredBarberId: str(f, "preferredBarberId") || null,
    preferredStyle: str(f, "preferredStyle"),
    notes: str(f, "notes"),
  };
}

export async function saveCustomerAction(id: string | null, _prev: ActionState, f: FormData): Promise<ActionState> {
  let newId: string | null = null;
  const res = await act(async (c) => {
    if (id) return updateCustomer(c, id, customerFields(f));
    const r = await createCustomer(c, { ...customerFields(f), utilityConsent: bool(f, "utility"), marketingConsent: bool(f, "marketing") });
    if (r.ok) newId = r.value.id;
    return r;
  }, "Saved.");
  if (newId) redirect(`/app/customers/${newId}`);
  return res;
}

export async function consentAction(id: string, purpose: "UTILITY" | "MARKETING", granted: boolean): Promise<ActionState> {
  return act((c) => setCustomerConsent(c, id, purpose, granted), "Consent updated.");
}

export async function mergeAction(keepId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  const res = await act((c) => mergeCustomers(c, keepId, str(f, "dropId")), "Customers merged.");
  return res;
}

export async function anonymiseAction(id: string): Promise<ActionState> {
  const res = await act((c) => anonymiseCustomer(c, id));
  if (res?.ok) redirect("/app/customers?deleted=1");
  return res;
}

// ───────── WhatsApp ─────────

export async function variantAction(id: string, variant: Variant): Promise<ActionState> {
  return act((c) => setDraftVariant(c, id, variant));
}

export async function approveAction(ids: string[] | "all", _prev: ActionState, f: FormData): Promise<ActionState> {
  const at = str(f, "sendAt");
  const c = await ctx();
  let sendAt: Date | undefined;
  if (at) {
    const [d, t] = at.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm] = t.split(":").map(Number);
    sendAt = atLocal(c.salon.timezone, y, m, day, hh, mm);
  }
  let summary = "";
  const res = await act(async (cc) => {
    const r = await approveDrafts(cc, ids, sendAt);
    if (r.ok) {
      summary = `${r.value.queued} approved${r.value.skipped ? `, ${r.value.skipped} skipped (booked, opted out or removed since)` : ""}.`;
    }
    return r;
  });
  if (res?.ok && ids === "all") redirect(`/app/whatsapp?tab=sent&approved=${encodeURIComponent(summary)}`);
  return res?.ok ? { ok: true, info: summary } : res;
}

export async function skipDraftAction(id: string): Promise<ActionState> {
  return act((c) => skipDraft(c, id), "Skipped.");
}

export async function retryAction(id: string): Promise<ActionState> {
  return act((c) => retryMessage(c, id), "Sent.");
}

export async function messagingPausedAction(paused: boolean): Promise<ActionState> {
  const { setMessagingPaused } = await import("@/server/staff/messaging");
  return act((c) => setMessagingPaused(c, paused), paused ? "Sending is paused." : "Sending resumed.");
}

export async function autoMessagesAction(f: FormData): Promise<void> {
  await act((c) =>
    updateAutoMessages(c, {
      dayBeforeReminderOn: bool(f, "dayBeforeReminderOn"),
      shortReminderOn: bool(f, "shortReminderOn"),
      birthdayMessageOn: bool(f, "birthdayMessageOn"),
      winbackOn: bool(f, "winbackOn"),
    }),
  );
}

export async function replyAction(conversationId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => replyInConversation(c, conversationId, str(f, "text")), "Sent.");
}

export async function handledAction(conversationId: string): Promise<ActionState> {
  return act((c) => markHandled(c, conversationId), "Marked as handled.");
}

export async function customerFromConversationAction(conversationId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => createCustomerFromConversation(c, conversationId, str(f, "name")), "Customer created.");
}

export async function simulateInboundAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const c = await ctx();
  const phone = normalizePhone(str(f, "phone"), c.salon.countryCode);
  if (!phone.ok) return { error: "Enter a valid number." };
  return act((cc) => simulateInbound(cc, phone.e164, str(f, "text")), "Simulated reply received.");
}

/** Development stand-in for the cron jobs, limited to the current salon. */
export async function runJobsNowAction(): Promise<ActionState> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TOOLS !== "true") return { error: "Not available." };
  const c = await ctx();
  try {
    assertCan(c.member, "messaging.settings");
  } catch {
    return { error: "Only the owner can do this." };
  }
  const daily = await runDailyJobs({ salonId: c.member.salonId });
  const sent = await dispatchDue({ salonId: c.member.salonId });
  refresh();
  return {
    ok: true,
    info: `Jobs ran: ${daily.winbackDrafts} new win-back drafts, ${daily.birthdays} birthday messages; ${sent.sent} sent, ${sent.skipped} skipped, ${sent.failed} failed, ${sent.deferred} waiting for quiet hours to end.`,
  };
}

// ───────── Settings ─────────

export async function profileAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => updateSalonProfile(c, { name: str(f, "name"), whatsappNumber: str(f, "whatsappNumber"), timezone: str(f, "timezone") }), "Saved.");
}

export async function rulesAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  return act(
    (c) =>
      updateBookingRules(c, {
        bookingEnabled: bool(f, "bookingEnabled"),
        autoConfirm: bool(f, "autoConfirm"),
        cancelCutoffMinutes: Math.round(num(f, "cancelCutoffHours") * 60),
        loyaltyOn: bool(f, "loyaltyOn"),
        loyaltyThreshold: num(f, "loyaltyThreshold"),
        slotGridMinutes: num(f, "slotGridMinutes"),
      }),
    "Saved.",
  );
}

export async function serviceAction(id: string | null, _prev: ActionState, f: FormData): Promise<ActionState> {
  const rr = str(f, "returnReminderDays");
  return act(
    (c) =>
      saveService(c, {
        id: id ?? undefined,
        name: str(f, "name"),
        durationMin: num(f, "durationMin"),
        bufferMin: num(f, "bufferMin") || 0,
        price: num(f, "price"),
        returnReminderDays: rr ? Number(rr) : null,
        loyaltyReward: bool(f, "loyaltyReward"),
        active: id ? bool(f, "active") : true,
      }),
    "Saved.",
  );
}

/** Reads the hours editor: d{day}on plus d{day}r{i}s / d{day}r{i}e for each range. */
function parseHours(f: FormData, prefix: string): HoursRange[] {
  const toMin = (v: string) => {
    const [hh, mm] = v.split(":").map(Number);
    return hh * 60 + (mm || 0);
  };
  const out: HoursRange[] = [];
  for (let d = 0; d < 7; d++) {
    if (!bool(f, `${prefix}${d}on`)) continue;
    for (let i = 0; i < 10; i++) {
      const s = str(f, `${prefix}${d}r${i}s`);
      const e = str(f, `${prefix}${d}r${i}e`);
      if (!s || !e) continue;
      out.push({ weekday: d, startMin: toMin(s), endMin: toMin(e) });
    }
  }
  return out;
}

export async function barberAction(id: string | null, _prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => saveBarber(c, { id: id ?? undefined, displayName: str(f, "displayName"), active: id ? bool(f, "active") : true, hours: parseHours(f, "d") }), "Saved.");
}

export async function hoursAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => setOpeningHours(c, parseHours(f, "d")), "Opening hours saved.");
}

export async function closedDateAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => addClosedDate(c, str(f, "date"), str(f, "reason")), "Closed date added.");
}

export async function removeClosedDateAction(id: string): Promise<ActionState> {
  return act((c) => removeClosedDate(c, id));
}

export async function timeOffAction(barberId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  const c = await ctx();
  const [sd, ed] = [str(f, "start"), str(f, "end")];
  if (!sd || !ed) return { error: "Choose the dates." };
  const toInstant = (v: string, endOfDay: boolean) => {
    const [y, m, d] = v.split("-").map(Number);
    return atLocal(c.salon.timezone, y, m, endOfDay ? d + 1 : d);
  };
  let clashes: { customer: string }[] = [];
  const res = await act(async (cc) => {
    const r = await addTimeOff(cc, barberId, toInstant(sd, false), toInstant(ed, true), str(f, "reason"));
    if (r.ok) clashes = r.value;
    return r;
  });
  if (res?.ok && clashes.length) {
    return { ok: true, info: `Time off saved. ${clashes.length} booking(s) clash and need moving: ${clashes.map((x) => x.customer).join(", ")}.` };
  }
  return res?.ok ? { ok: true, info: "Time off saved." } : res;
}

export async function inviteAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const c = await ctx();
  try {
    const r = await inviteStaff(c, { email: str(f, "email"), role: str(f, "role") as "owner" | "receptionist" | "barber", barberId: str(f, "barberId") || null });
    if (!r.ok) return { error: r.message };
    refresh();
    return { ok: true, info: "Invitation sent. You can also share this link (valid 7 days):", link: r.value.link };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
    throw err;
  }
}

export async function revokeInviteAction(id: string): Promise<ActionState> {
  return act((c) => revokeInvitation(c, id), "Invitation cancelled.");
}

export async function memberAccessAction(memberId: string, _prev: ActionState, f: FormData): Promise<ActionState> {
  return act((c) => setMemberAccess(c, memberId, { active: bool(f, "active"), role: str(f, "role") as "owner" | "receptionist" | "barber" }), "Saved.");
}

export async function promotionAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  return act(
    (c) =>
      savePromotion(c, {
        name: str(f, "name"),
        kind: str(f, "kind") as "PERCENT" | "FIXED" | "FREE_SERVICE",
        value: num(f, "value") || 0,
        serviceIds: f.getAll("serviceIds").map(String),
        startsOn: str(f, "startsOn"),
        endsOn: str(f, "endsOn"),
        isBirthday: bool(f, "isBirthday"),
      }),
    "Offer saved.",
  );
}

export async function endPromotionAction(id: string): Promise<ActionState> {
  return act((c) => endPromotion(c, id), "Offer ended.");
}

// ───────── AI copy assistant (US-30) ─────────

export type SuggestState = { error?: string; drafts?: string[]; generationId?: string } | null;

export async function suggestWordingAction(variant: "friendly" | "short" | "with_offer", _prev: SuggestState, f: FormData): Promise<SuggestState> {
  const c = await ctx();
  try {
    const { draftCopy } = await import("@/server/staff/copy-assistant");
    const tone = (["friendly", "professional", "playful"].includes(str(f, "tone")) ? str(f, "tone") : "friendly") as "friendly" | "professional" | "playful";
    const r = await draftCopy(c, { variant, tone, ownerBrief: str(f, "brief") });
    return r.ok ? { drafts: r.value.drafts, generationId: r.value.generationId } : { error: r.message };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "Only the owner can do this." };
    throw err;
  }
}

export async function saveWordingAction(variant: "friendly" | "short" | "with_offer", _prev: ActionState, f: FormData): Promise<ActionState> {
  const { saveWording } = await import("@/server/staff/copy-assistant");
  return act((c) => saveWording(c, { variant, wording: str(f, "wording"), generationId: str(f, "generationId") || undefined, pickedDraft: String(f.get("pickedDraft") ?? "") || undefined }), "Saved. New messages use this wording once WhatsApp approves it (immediately in test mode).");
}

// ───────── Offer campaigns ─────────

export type CampaignPreviewState =
  | { error?: string; recipients?: number; total?: number; excluded?: { noConsent: number; capped: number; holdout: number; badNumber: number }; costUsd?: number; preview?: string | null; wordingError?: string | null }
  | null;

function campaignInput(f: FormData) {
  return {
    promotionId: str(f, "promotionId"),
    segment: (str(f, "segment") || "all") as import("@/server/staff/campaigns").CampaignSegment,
    wording: String(f.get("wording") ?? ""),
    generationId: str(f, "generationId") || undefined,
    pickedDraft: String(f.get("pickedDraft") ?? "") || undefined,
  };
}

export async function previewCampaignAction(_prev: CampaignPreviewState, f: FormData): Promise<CampaignPreviewState> {
  const c = await ctx();
  try {
    const { previewCampaign } = await import("@/server/staff/campaigns");
    const r = await previewCampaign(c, campaignInput(f));
    return r.ok ? r.value : { error: r.message };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "Only the owner can send offers." };
    throw err;
  }
}

export async function sendCampaignAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const { sendCampaign } = await import("@/server/staff/campaigns");
  let summary = "";
  const res = await act(async (c) => {
    const r = await sendCampaign(c, campaignInput(f));
    if (r.ok) summary = `${r.value.queued} offer message${r.value.queued === 1 ? "" : "s"} approved${r.value.duplicates ? ` (${r.value.duplicates} already had this offer today)` : ""}.`;
    return r;
  });
  if (res?.ok) redirect(`/app/whatsapp?tab=sent&approved=${encodeURIComponent(summary)}`);
  return res;
}

export async function suggestCampaignWordingAction(_prev: SuggestState, f: FormData): Promise<SuggestState> {
  const c = await ctx();
  try {
    const { runningOfferLine } = await import("@/server/staff/campaigns");
    const { draftCopy } = await import("@/server/staff/copy-assistant");
    const line = await runningOfferLine(c, str(f, "promotionId"));
    if (!line) return { error: "Choose an offer that is running today." };
    const tone = (["friendly", "professional", "playful"].includes(str(f, "tone")) ? str(f, "tone") : "friendly") as "friendly" | "professional" | "playful";
    const r = await draftCopy(c, { variant: "friendly", goal: "promotion", promotionLine: line, tone, ownerBrief: str(f, "brief") });
    return r.ok ? { drafts: r.value.drafts, generationId: r.value.generationId } : { error: r.message };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "Only the owner can do this." };
    throw err;
  }
}

// ───────── Online payments (US-17) ─────────

export type LinkState = { error?: string; url?: string; whatsapp?: string | null } | null;

export async function paymentLinkAction(bookingId: string): Promise<LinkState> {
  const c = await ctx();
  const { createPaymentLinkForStaff } = await import("@/server/payments/links");
  const r = await createPaymentLinkForStaff(c, bookingId);
  if (!r.ok) return { error: r.message };
  const text = `Hi, here's the payment link for your booking ${r.value.bookingRef} at ${c.salon.name}: ${r.value.url}`;
  return { url: r.value.url, whatsapp: r.value.customerPhone ? `https://wa.me/${r.value.customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : null };
}

export async function paymentProviderAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const { setPaymentProvider } = await import("@/server/staff/settings");
  const v = str(f, "provider");
  return act((cc) => setPaymentProvider(cc, v === "PAYSTACK" || v === "STRIPE" ? v : null), "Saved.");
}

export async function connectPaystackAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const { connectPaystackAccount } = await import("@/server/staff/settings");
  return act((cc) => connectPaystackAccount(cc, { bankCode: str(f, "bank"), accountNumber: str(f, "accountNumber") }), "Account connected. Customers can now pay online.");
}

/** The link to Stripe's onboarding pages (straight back in test mode); the browser opens it. */
export async function startStripeConnectAction(): Promise<ActionState> {
  const { startStripeConnect } = await import("@/server/staff/settings");
  const s = await requireStaff();
  try {
    const r = await startStripeConnect({ member: s.member, salon: s.salon, user: s.user }, s.user.email);
    return r.ok ? { ok: true, link: r.value.url } : { error: r.message };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
    throw err;
  }
}

export async function disconnectPaymentAccountAction(): Promise<ActionState> {
  const { disconnectPaymentAccount } = await import("@/server/staff/settings");
  return act((cc) => disconnectPaymentAccount(cc), "Disconnected. Customers pay at the salon until you connect again.");
}

/** Calendar drag-and-drop: same checks as the Reschedule panel. */
export async function moveBookingAction(bookingId: string, startsAtIso: string, barberId: string): Promise<ActionState> {
  return act((c) => rescheduleBookingStaff(c, bookingId, new Date(startsAtIso), barberId), "Booking moved.");
}
