// WhatsApp hub (design p9), approval queue (p10) and inbox (US-28).
import { formatShortDate, formatTime } from "@/domain/format";
import { estimateCostUsd } from "@/domain/messaging-rules";
import { formatPhone } from "@/domain/phone";
import { forSalon } from "@/server/db";
import { getProvider } from "@/server/messaging/provider";
import type { StaffCtx } from "../context";
import { activeOffer } from "../messaging";
import { typeLabel } from "./dashboard";
import { todayRange } from "./common";

const WINDOW_MS = 24 * 3600_000;

export type HubTab = "scheduled" | "sent" | "failed" | "inbox";

export async function whatsappHub(ctx: StaffCtx, tab: HubTab, now = new Date()) {
  const { member, salon } = ctx;
  const db = forSalon(member.salonId);
  const tz = salon.timezone;
  const today = todayRange(tz, now);
  const sentStatuses = ["SENT", "DELIVERED", "READ"] as const;

  const [sentToday, drafts, scheduledCount, sentCount, failedCount, unread] = await Promise.all([
    db.message.count({ where: { status: { in: [...sentStatuses] }, sentAt: { gte: today.start } } }),
    db.message.count({ where: { type: "WINBACK", status: "DRAFT" } }),
    db.message.count({ where: { status: "QUEUED" } }),
    db.message.count({ where: { status: { in: [...sentStatuses] }, sentAt: { gte: today.start } } }),
    db.message.count({ where: { status: "FAILED", createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
    db.conversation.aggregate({ _sum: { unreadCount: true } }),
  ]);

  const listWhere =
    tab === "scheduled"
      ? { status: "QUEUED" as const }
      : tab === "sent"
        ? { status: { in: [...sentStatuses] } }
        : { status: "FAILED" as const, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } };
  const list =
    tab === "inbox"
      ? []
      : await db.message.findMany({
          where: listWhere,
          include: { customer: { select: { id: true, name: true, phoneInvalid: true } } },
          orderBy: tab === "scheduled" ? { scheduledFor: "asc" } : { createdAt: "desc" },
          take: 50,
        });
  const failures = await db.message.findMany({
    where: { status: "FAILED", createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    include: { customer: { select: { id: true, name: true, phoneInvalid: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const conversations =
    tab === "inbox"
      ? await db.conversation.findMany({
          include: { customer: { select: { name: true } }, inbound: { orderBy: { receivedAt: "desc" }, take: 1 } },
          orderBy: { lastInboundAt: { sort: "desc", nulls: "last" } },
          take: 50,
        })
      : [];

  const when = (d: Date) => {
    const iso = d.toISOString();
    const isToday = d >= today.start && d < today.end;
    return `${isToday ? "Today" : formatShortDate(iso, tz)} ${formatTime(iso, tz)}`;
  };

  return {
    provider: getProvider().name,
    number: salon.whatsappNumber,
    sentToday,
    drafts,
    counts: { scheduled: scheduledCount, sent: sentCount, failed: failedCount, unread: unread._sum.unreadCount ?? 0 },
    paused: salon.messagingPaused || process.env.MESSAGING_PAUSED === "true",
    pausedPlatformWide: process.env.MESSAGING_PAUSED === "true",
    settings: {
      dayBeforeReminderOn: salon.dayBeforeReminderOn,
      dayBeforeReminderHour: salon.dayBeforeReminderHour,
      shortReminderOn: salon.shortReminderOn,
      shortReminderHours: salon.shortReminderHours,
      birthdayMessageOn: salon.birthdayMessageOn,
      winbackOn: salon.winbackOn,
    },
    canEditSettings: member.role === "owner",
    list: list.map((m) => ({
      id: m.id,
      customerId: m.customer.id,
      customer: m.customer.name,
      type: typeLabel(m.type),
      when: when(tab === "scheduled" ? (m.nextAttemptAt ?? m.scheduledFor) : (m.sentAt ?? m.createdAt)),
      text: m.renderedText,
      status: m.status,
      reason: m.failureReason,
    })),
    failures: failures.map((m) => ({
      id: m.id,
      customerId: m.customer.id,
      customer: m.customer.name,
      type: typeLabel(m.type),
      reason: m.failureReason,
      notOnWhatsApp: m.failureReason === "not_on_whatsapp" || m.customer.phoneInvalid,
    })),
    conversations: conversations.map((c) => ({
      id: c.id,
      name: c.customer?.name ?? `Unknown number ${formatPhone(c.phoneE164)}`,
      last: c.inbound[0]?.text ?? "",
      when: c.lastInboundAt ? when(c.lastInboundAt) : "",
      unread: c.unreadCount,
      handled: c.status === "HANDLED",
      windowOpen: Boolean(c.lastInboundAt && now.getTime() - c.lastInboundAt.getTime() < WINDOW_MS),
    })),
  };
}

export async function approvalQueue(ctx: StaffCtx, now = new Date()) {
  const db = forSalon(ctx.member.salonId);
  const [drafts, offer] = await Promise.all([
    db.message.findMany({
      where: { type: "WINBACK", status: "DRAFT" },
      include: { customer: { select: { id: true, name: true } }, template: { select: { variant: true } } },
      orderBy: { createdAt: "asc" },
    }),
    activeOffer(db, ctx.salon, now),
  ]);
  return {
    offer: offer ? { name: offer.name, line: offer.line } : null,
    costUsd: estimateCostUsd(drafts.length, "marketing", ctx.salon.countryCode),
    drafts: drafts.map((d, i) => ({
      id: d.id,
      index: i + 1,
      customerId: d.customer.id,
      name: d.customer.name,
      whyNow: d.whyNow,
      text: d.renderedText,
      variant: (d.template?.variant ?? "friendly") as "friendly" | "short" | "with_offer",
    })),
  };
}

export async function conversationThread(ctx: StaffCtx, id: string, now = new Date()) {
  const db = forSalon(ctx.member.salonId);
  const c = await db.conversation.findFirst({ where: { id }, include: { customer: true, inbound: { orderBy: { receivedAt: "asc" } } } });
  if (!c) return null;
  const outbound = c.customerId
    ? await db.message.findMany({
        where: { customerId: c.customerId, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        take: 100,
      })
    : [];
  const tz = ctx.salon.timezone;
  const items = [
    ...c.inbound.map((m) => ({ id: m.id, at: m.receivedAt, from: "customer" as const, text: m.text, keyword: m.keyword, status: null as string | null })),
    ...outbound.map((m) => ({ id: m.id, at: m.sentAt ?? m.createdAt, from: "salon" as const, text: m.renderedText, keyword: null, status: m.status })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const windowLeftMs = c.lastInboundAt ? WINDOW_MS - (now.getTime() - c.lastInboundAt.getTime()) : 0;
  return {
    id: c.id,
    customerId: c.customerId,
    name: c.customer?.name ?? null,
    phone: formatPhone(c.phoneE164),
    handled: c.status === "HANDLED",
    windowOpen: windowLeftMs > 0,
    windowHoursLeft: Math.max(0, Math.floor(windowLeftMs / 3_600_000)),
    items: items.map((i) => ({ ...i, when: `${formatShortDate(i.at.toISOString(), tz)} ${formatTime(i.at.toISOString(), tz)}` })),
  };
}
