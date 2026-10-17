// Settings (US-02–US-06, US-29 AC1, design p12) and offers (BR-PR1).
// Member and Invitation are not tenant-scoped by forSalon(), so every query filters salonId explicitly.
import { toMinor } from "@/domain/money";
import type { MemberRole } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import { forSalon } from "@/server/db";
import { sendEmail } from "@/server/email";
import { newInviteToken } from "@/server/links";
import { appUrl } from "@/server/messaging/queue";
import { createPaystackSubaccount, createStripeAccount, PAYSTACK_CURRENCIES, ProviderError, stripeAccountStatus, stripeOnboardingLink } from "@/server/payments/accounts";
import { liveProvider, paymentsMode } from "@/server/payments/providers";
import { fail, ok, staffAudit, type StaffCtx } from "./context";
import { log } from "@/server/log";

export type HoursRange = { weekday: number; startMin: number; endMin: number };

function validRanges(ranges: HoursRange[]): string | null {
  for (const r of ranges) {
    if (r.weekday < 0 || r.weekday > 6) return "Invalid day.";
    if (!(r.startMin >= 0 && r.endMin <= 24 * 60 && r.startMin < r.endMin)) return "Each time range must end after it starts.";
  }
  for (let d = 0; d < 7; d++) {
    const day = ranges.filter((r) => r.weekday === d).sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < day.length; i++) if (day[i].startMin < day[i - 1].endMin) return "Time ranges on the same day can't overlap.";
  }
  return null;
}

export async function updateSalonProfile(ctx: StaffCtx, input: { name: string; whatsappNumber?: string; timezone: string }) {
  assertCan(ctx.member, "salon.settings");
  if (input.name.trim().length < 2) return fail("Enter the salon name.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    return fail("Unknown timezone.");
  }
  const db = forSalon(ctx.member.salonId);
  await db.salon.update({
    where: { id: ctx.member.salonId },
    data: { name: input.name.trim(), whatsappNumber: input.whatsappNumber?.trim() || null, timezone: input.timezone },
  });
  await audit(db, { ...staffAudit(ctx), action: "salon.profile_changed", entityType: "Salon", entityId: ctx.member.salonId });
  return ok;
}

export async function updateBookingRules(
  ctx: StaffCtx,
  input: { bookingEnabled: boolean; autoConfirm: boolean; cancelCutoffMinutes: number; loyaltyOn: boolean; loyaltyThreshold: number; slotGridMinutes: number },
) {
  assertCan(ctx.member, "salon.settings");
  if (![10, 15, 20, 30, 60].includes(input.slotGridMinutes)) return fail("Choose a slot length.");
  if (input.cancelCutoffMinutes < 0 || input.cancelCutoffMinutes > 72 * 60) return fail("Cancellation cutoff must be 0–72 hours.");
  if (!Number.isInteger(input.loyaltyThreshold) || input.loyaltyThreshold < 2 || input.loyaltyThreshold > 50) return fail("Loyalty needs 2–50 visits.");
  const db = forSalon(ctx.member.salonId);
  await db.salon.update({ where: { id: ctx.member.salonId }, data: input });
  await audit(db, { ...staffAudit(ctx), action: "salon.booking_rules_changed", entityType: "Salon", entityId: ctx.member.salonId, after: input });
  return ok;
}

export async function saveService(
  ctx: StaffCtx,
  input: { id?: string; name: string; durationMin: number; bufferMin: number; price: number; returnReminderDays?: number | null; loyaltyReward: boolean; active: boolean },
) {
  assertCan(ctx.member, "services.manage");
  if (input.name.trim().length < 2) return fail("Enter a service name.");
  if (!(input.durationMin >= 5 && input.durationMin <= 480)) return fail("Duration must be 5–480 minutes.");
  if (!(input.bufferMin >= 0 && input.bufferMin <= 120)) return fail("Buffer must be 0–120 minutes.");
  if (!(input.price >= 0)) return fail("Price can't be negative.");
  if (input.returnReminderDays != null && !(input.returnReminderDays >= 7 && input.returnReminderDays <= 90)) {
    return fail("Return reminder must be 7–90 days.");
  }
  const db = forSalon(ctx.member.salonId);
  const data = {
    name: input.name.trim(),
    durationMin: input.durationMin,
    bufferMin: input.bufferMin,
    priceMinor: toMinor(input.price, ctx.salon.currency),
    currency: ctx.salon.currency,
    returnReminderDays: input.returnReminderDays ?? null,
    loyaltyReward: input.loyaltyReward,
    active: input.active,
  };
  if (input.id) {
    const { count } = await db.service.updateMany({ where: { id: input.id }, data });
    if (!count) return fail("Service not found.");
  } else {
    const order = await db.service.count();
    await db.service.create({ data: { ...data, salonId: ctx.member.salonId, sortOrder: order } });
  }
  await audit(db, { ...staffAudit(ctx), action: "service.saved", entityType: "Service", entityId: input.id ?? "new", after: { name: data.name, priceMinor: data.priceMinor } });
  return ok;
}

export async function saveBarber(ctx: StaffCtx, input: { id?: string; displayName: string; active: boolean; hours: HoursRange[] }) {
  const isSelf = Boolean(input.id && input.id === ctx.member.barberId);
  if (!input.id || !isSelf) assertCan(ctx.member, "staff.manage");
  else assertCan(ctx.member, "availability.edit", input.id);
  if (input.displayName.trim().length < 2) return fail("Enter the barber's name.");
  const invalid = validRanges(input.hours);
  if (invalid) return fail(invalid);
  const db = forSalon(ctx.member.salonId);
  await db.$transaction(async (tx) => {
    let id = input.id;
    if (id) {
      const { count } = await tx.barber.updateMany({
        where: { id },
        // Barbers can change their own hours, not their name or whether they're active.
        data: isSelf && ctx.member.role === "barber" ? {} : { displayName: input.displayName.trim(), active: input.active },
      });
      if (!count) throw new Error("Barber not found");
      await tx.barberHours.deleteMany({ where: { barberId: id } });
    } else {
      const order = await tx.barber.count();
      id = (await tx.barber.create({ data: { salonId: ctx.member.salonId, displayName: input.displayName.trim(), sortOrder: order } })).id;
    }
    if (input.hours.length) {
      await tx.barberHours.createMany({ data: input.hours.map((h) => ({ ...h, barberId: id!, salonId: ctx.member.salonId })) });
    }
    await audit(tx, { ...staffAudit(ctx), action: "barber.saved", entityType: "Barber", entityId: id! });
  });
  return ok;
}

export async function setOpeningHours(ctx: StaffCtx, hours: HoursRange[]) {
  assertCan(ctx.member, "salon.settings");
  const invalid = validRanges(hours);
  if (invalid) return fail(invalid);
  const db = forSalon(ctx.member.salonId);
  await db.$transaction(async (tx) => {
    await tx.openingHours.deleteMany({ where: {} });
    if (hours.length) await tx.openingHours.createMany({ data: hours.map((h) => ({ ...h, salonId: ctx.member.salonId })) });
    await audit(tx, { ...staffAudit(ctx), action: "salon.hours_changed", entityType: "Salon", entityId: ctx.member.salonId });
  });
  return ok;
}

export async function addClosedDate(ctx: StaffCtx, dateKey: string, reason?: string) {
  assertCan(ctx.member, "salon.settings");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return fail("Choose a date.");
  const db = forSalon(ctx.member.salonId);
  await db.closedDate.createMany({
    data: [{ salonId: ctx.member.salonId, date: new Date(`${dateKey}T00:00:00Z`), reason: reason?.trim() || null }],
    skipDuplicates: true,
  });
  return ok;
}

export async function removeClosedDate(ctx: StaffCtx, id: string) {
  assertCan(ctx.member, "salon.settings");
  await forSalon(ctx.member.salonId).closedDate.deleteMany({ where: { id } });
  return ok;
}

/** US-06 AC2: adding time off returns the bookings that now clash, for staff to move. */
export async function addTimeOff(ctx: StaffCtx, barberId: string, startsAt: Date, endsAt: Date, reason?: string) {
  assertCan(ctx.member, "availability.edit", barberId);
  if (!(endsAt > startsAt)) return fail("Time off must end after it starts.");
  const db = forSalon(ctx.member.salonId);
  if (!(await db.barber.findFirst({ where: { id: barberId } }))) return fail("Barber not found.");
  await db.timeOff.create({ data: { salonId: ctx.member.salonId, barberId, startsAt, endsAt, reason: reason?.trim() || null } });
  const clashes = await db.booking.findMany({
    where: { barberId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    include: { customer: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });
  return { ok: true as const, value: clashes.map((c) => ({ id: c.id, customer: c.customer.name, startsAt: c.startsAt.toISOString() })) };
}

export async function removeTimeOff(ctx: StaffCtx, id: string) {
  const db = forSalon(ctx.member.salonId);
  const t = await db.timeOff.findFirst({ where: { id } });
  if (!t) return fail("Not found.");
  assertCan(ctx.member, "availability.edit", t.barberId);
  await db.timeOff.deleteMany({ where: { id } });
  return ok;
}

// ───────── Staff (US-03, US-04) ─────────

const INVITE_DAYS = 7;

export async function inviteStaff(ctx: StaffCtx, input: { email: string; role: MemberRole; barberId?: string | null }) {
  assertCan(ctx.member, "staff.manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
  if (!["owner", "receptionist", "barber"].includes(input.role)) return fail("Choose a role.");
  const db = forSalon(ctx.member.salonId);
  if (input.barberId && !(await db.barber.findFirst({ where: { id: input.barberId, memberId: null } }))) {
    return fail("That barber profile already has a login.");
  }
  const { token, tokenHash } = newInviteToken();
  await db.$transaction(async (tx) => {
    // A new invite replaces any pending one for the same email.
    await tx.invitation.updateMany({ where: { salonId: ctx.member.salonId, email, status: "PENDING" }, data: { status: "REVOKED" } });
    const inv = await tx.invitation.create({
      data: {
        salonId: ctx.member.salonId,
        email,
        role: input.role,
        barberId: input.barberId || null,
        tokenHash,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
        inviterId: ctx.member.userId,
      },
    });
    await audit(tx, { ...staffAudit(ctx), action: "staff.invited", entityType: "Invitation", entityId: inv.id, after: { email, role: input.role } });
  });
  const link = `${appUrl()}/invite/${token}`;
  await sendEmail({
    to: email,
    subject: `${ctx.user.name} invited you to ${ctx.salon.name}`,
    text: `You've been invited to join ${ctx.salon.name} as a ${input.role}. Accept within ${INVITE_DAYS} days: ${link}`,
  });
  // Returned once so the owner can also share it on WhatsApp; only the hash is stored.
  return { ok: true as const, value: { link } };
}

export async function revokeInvitation(ctx: StaffCtx, id: string) {
  assertCan(ctx.member, "staff.manage");
  const db = forSalon(ctx.member.salonId);
  const { count } = await db.invitation.updateMany({ where: { id, salonId: ctx.member.salonId, status: "PENDING" }, data: { status: "REVOKED" } });
  return count ? ok : fail("Invitation not found.");
}

export async function setMemberAccess(ctx: StaffCtx, memberId: string, input: { active: boolean; role: MemberRole }) {
  assertCan(ctx.member, "staff.manage");
  const db = forSalon(ctx.member.salonId);
  const m = await db.member.findFirst({ where: { id: memberId, salonId: ctx.member.salonId } });
  if (!m) return fail("Staff member not found.");
  if (m.userId === ctx.member.userId) return fail("You can't change your own access.");
  if (m.role === "owner" && (!input.active || input.role !== "owner")) {
    const owners = await db.member.count({ where: { salonId: ctx.member.salonId, role: "owner", active: true } });
    if (owners <= 1) return fail("A salon needs at least one owner.");
  }
  await db.$transaction(async (tx) => {
    await tx.member.update({ where: { id: m.id }, data: input });
    await audit(tx, {
      ...staffAudit(ctx),
      action: input.active ? "staff.role_changed" : "staff.deactivated",
      entityType: "Member",
      entityId: m.id,
      before: { role: m.role, active: m.active },
      after: input,
    });
  });
  return ok;
}

// ───────── Offers (BR-PR1, BR-PR2) ─────────

export async function savePromotion(
  ctx: StaffCtx,
  input: { name: string; kind: "PERCENT" | "FIXED" | "FREE_SERVICE"; value: number; serviceIds: string[]; startsOn: string; endsOn: string; isBirthday: boolean },
) {
  assertCan(ctx.member, "promotions.approve");
  if (input.name.trim().length < 2) return fail("Name the offer.");
  if (input.kind === "PERCENT" && !(input.value >= 1 && input.value <= 100)) return fail("Percent must be 1–100.");
  if (input.kind === "FIXED" && !(input.value > 0)) return fail("Enter the amount off.");
  if (!input.serviceIds.length) return fail("Choose at least one service.");
  if (!(input.startsOn <= input.endsOn)) return fail("The offer must end on or after it starts.");
  const db = forSalon(ctx.member.salonId);
  const services = await db.service.count({ where: { id: { in: input.serviceIds } } });
  if (services !== input.serviceIds.length) return fail("Choose services from this salon.");
  const promo = await db.promotion.create({
    data: {
      salonId: ctx.member.salonId,
      name: input.name.trim(),
      kind: input.kind,
      value: input.kind === "FIXED" ? toMinor(input.value, ctx.salon.currency) : input.kind === "PERCENT" ? Math.round(input.value) : 0,
      serviceIds: input.serviceIds,
      startsOn: new Date(`${input.startsOn}T00:00:00Z`),
      endsOn: new Date(`${input.endsOn}T00:00:00Z`),
      isBirthday: input.isBirthday,
    },
  });
  await audit(db, { ...staffAudit(ctx), action: "promotion.created", entityType: "Promotion", entityId: promo.id });
  return ok;
}

export async function endPromotion(ctx: StaffCtx, id: string) {
  assertCan(ctx.member, "promotions.approve");
  const { count } = await forSalon(ctx.member.salonId).promotion.updateMany({ where: { id }, data: { active: false } });
  return count ? ok : fail("Offer not found.");
}

/** US-17: which provider the salon uses for online payment links (null = off). Changing it disconnects the old account. */
export async function setPaymentProvider(ctx: StaffCtx, kind: "PAYSTACK" | "STRIPE" | null) {
  assertCan(ctx.member, "salon.settings");
  if (kind !== null && kind !== "PAYSTACK" && kind !== "STRIPE") return fail("Choose Paystack, Stripe or off.");
  if (kind === "PAYSTACK" && !PAYSTACK_CURRENCIES.has(ctx.salon.currency)) return fail(`Paystack doesn't take ${ctx.salon.currency}. Choose Stripe.`);
  if (kind && paymentsMode() === "live" && !liveProvider(kind)) {
    return fail(`${kind === "PAYSTACK" ? "Paystack" : "Stripe"} keys aren't configured on the server yet.`);
  }
  const db = forSalon(ctx.member.salonId);
  const current = await db.salon.findUniqueOrThrow({ where: { id: ctx.member.salonId }, select: { paymentProvider: true } });
  const changed = current.paymentProvider !== kind;
  await db.salon.update({
    where: { id: ctx.member.salonId },
    data: { paymentProvider: kind, ...(changed ? { paymentProviderAccount: null, paymentAccountReady: false, paymentAccountLabel: null } : {}) },
  });
  await audit(db, { ...staffAudit(ctx), action: "salon.payment_provider_changed", entityType: "Salon", entityId: ctx.member.salonId, after: { kind } });
  return ok;
}

async function paymentSettings(ctx: StaffCtx) {
  return forSalon(ctx.member.salonId).salon.findUniqueOrThrow({
    where: { id: ctx.member.salonId },
    select: { name: true, countryCode: true, paymentProvider: true, paymentProviderAccount: true, paymentAccountReady: true },
  });
}

async function saveAccount(ctx: StaffCtx, data: { paymentProviderAccount: string | null; paymentAccountReady: boolean; paymentAccountLabel: string | null }, action: string) {
  const db = forSalon(ctx.member.salonId);
  await db.salon.update({ where: { id: ctx.member.salonId }, data });
  // The label only: never bank account numbers in the audit log.
  await audit(db, { ...staffAudit(ctx), action, entityType: "Salon", entityId: ctx.member.salonId, after: { ready: data.paymentAccountReady, label: data.paymentAccountLabel } });
}

function providerMessage(err: unknown): string {
  if (err instanceof ProviderError && err.status < 500) return err.message;
  log.error("payment_account.setup_failed", err);
  return "The payment provider didn't respond. Please try again.";
}

/** ADR-0006: create the salon's Paystack subaccount; takings settle to this bank account. */
export async function connectPaystackAccount(ctx: StaffCtx, input: { bankCode: string; accountNumber: string }) {
  assertCan(ctx.member, "salon.settings");
  const salon = await paymentSettings(ctx);
  if (salon.paymentProvider !== "PAYSTACK") return fail("Choose Paystack first.");
  const accountNumber = input.accountNumber.replace(/\s/g, "");
  if (!input.bankCode) return fail("Choose your bank.");
  if (!/^\d{6,20}$/.test(accountNumber)) return fail("Enter the account number using digits only.");
  try {
    const { account, label } = await createPaystackSubaccount({ salonId: ctx.member.salonId, businessName: salon.name, bankCode: input.bankCode, accountNumber });
    await saveAccount(ctx, { paymentProviderAccount: account, paymentAccountReady: true, paymentAccountLabel: label }, "payment_account.connected");
    return ok;
  } catch (err) {
    return fail(providerMessage(err));
  }
}

/** ADR-0006: Stripe Connect Standard. Returns Stripe's onboarding page; the owner comes back to /app/settings/stripe. */
export async function startStripeConnect(ctx: StaffCtx, ownerEmail: string) {
  assertCan(ctx.member, "salon.settings");
  const salon = await paymentSettings(ctx);
  if (salon.paymentProvider !== "STRIPE") return fail("Choose Stripe first.");
  try {
    let account = salon.paymentProviderAccount;
    if (!account) {
      account = await createStripeAccount({ salonId: ctx.member.salonId, countryCode: salon.countryCode, email: ownerEmail });
      await saveAccount(ctx, { paymentProviderAccount: account, paymentAccountReady: false, paymentAccountLabel: null }, "payment_account.started");
    }
    const back = `${appUrl()}/app/settings/stripe`;
    return { ok: true as const, value: { url: await stripeOnboardingLink(account, `${back}?step=refresh`, `${back}?step=return`) } };
  } catch (err) {
    return fail(providerMessage(err));
  }
}

/** After Stripe onboarding (and on demand): can the account take charges yet? */
export async function refreshStripeAccount(ctx: StaffCtx) {
  assertCan(ctx.member, "salon.settings");
  const salon = await paymentSettings(ctx);
  if (salon.paymentProvider !== "STRIPE" || !salon.paymentProviderAccount) return fail("Set up Stripe first.");
  try {
    const status = await stripeAccountStatus(salon.paymentProviderAccount);
    if (status.ready !== salon.paymentAccountReady || status.ready) {
      await saveAccount(ctx, { paymentProviderAccount: salon.paymentProviderAccount, paymentAccountReady: status.ready, paymentAccountLabel: status.label }, status.ready ? "payment_account.connected" : "payment_account.pending");
    }
    return { ok: true as const, value: { ready: status.ready } };
  } catch (err) {
    return fail(providerMessage(err));
  }
}

/** Stops online payments. Payments already taken stay recorded. */
export async function disconnectPaymentAccount(ctx: StaffCtx) {
  assertCan(ctx.member, "salon.settings");
  await saveAccount(ctx, { paymentProviderAccount: null, paymentAccountReady: false, paymentAccountLabel: null }, "payment_account.disconnected");
  return ok;
}
