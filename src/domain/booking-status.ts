// Booking lifecycle (docs/business-rules.md §3, BR-B1, BR-B3).

export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

type Transition = { to: BookingStatus; ownerOnly?: boolean };

// Forward transitions are open to staff. The two corrections (undoing a wrong
// "Done" or "No-show") are owner-only and always audit-logged.
const TRANSITIONS: Record<BookingStatus, readonly Transition[]> = {
  PENDING: [{ to: "CONFIRMED" }, { to: "CANCELLED" }, { to: "NO_SHOW" }],
  CONFIRMED: [{ to: "IN_PROGRESS" }, { to: "CANCELLED" }, { to: "NO_SHOW" }],
  IN_PROGRESS: [{ to: "COMPLETED" }, { to: "CANCELLED" }],
  COMPLETED: [{ to: "IN_PROGRESS", ownerOnly: true }],
  CANCELLED: [],
  NO_SHOW: [{ to: "CONFIRMED", ownerOnly: true }],
};

/** Statuses that occupy the barber's time (BR-A2). */
export const BLOCKING_STATUSES: readonly BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
];

export type TransitionContext = {
  now: Date;
  startsAt: Date;
  noShowGraceMinutes: number;
  isOwner: boolean;
};

export type TransitionResult =
  | { ok: true; correction: boolean }
  | { ok: false; reason: "not_allowed" | "owner_only" | "too_early_for_no_show" };

export function checkTransition(
  from: BookingStatus,
  to: BookingStatus,
  ctx: TransitionContext,
): TransitionResult {
  const transition = TRANSITIONS[from].find((t) => t.to === to);
  if (!transition) return { ok: false, reason: "not_allowed" };
  if (transition.ownerOnly && !ctx.isOwner) return { ok: false, reason: "owner_only" };

  if (to === "NO_SHOW") {
    const earliest = ctx.startsAt.getTime() + ctx.noShowGraceMinutes * 60_000;
    if (ctx.now.getTime() < earliest) return { ok: false, reason: "too_early_for_no_show" };
  }
  return { ok: true, correction: Boolean(transition.ownerOnly) };
}

export function allowedNextStatuses(from: BookingStatus, isOwner: boolean): BookingStatus[] {
  return TRANSITIONS[from].filter((t) => isOwner || !t.ownerOnly).map((t) => t.to);
}
