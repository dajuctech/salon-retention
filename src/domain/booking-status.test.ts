import { describe, expect, it } from "vitest";
import { allowedNextStatuses, checkTransition } from "./booking-status";

const startsAt = new Date("2026-10-15T10:30:00Z");
const ctx = (now: string, isOwner = false) => ({
  now: new Date(now),
  startsAt,
  noShowGraceMinutes: 15,
  isOwner,
});

describe("BR-B1 booking transitions", () => {
  it("allows the normal flow PENDING → CONFIRMED → IN_PROGRESS → COMPLETED", () => {
    const now = "2026-10-15T10:30:00Z";
    expect(checkTransition("PENDING", "CONFIRMED", ctx(now)).ok).toBe(true);
    expect(checkTransition("CONFIRMED", "IN_PROGRESS", ctx(now)).ok).toBe(true);
    expect(checkTransition("IN_PROGRESS", "COMPLETED", ctx(now)).ok).toBe(true);
  });

  it("rejects transitions not in the diagram", () => {
    expect(checkTransition("CANCELLED", "CONFIRMED", ctx("2026-10-15T09:00:00Z"))).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(checkTransition("PENDING", "COMPLETED", ctx("2026-10-15T09:00:00Z")).ok).toBe(false);
  });

  it("allows corrections for owners only, flagged as corrections", () => {
    const now = "2026-10-15T12:00:00Z";
    expect(checkTransition("NO_SHOW", "CONFIRMED", ctx(now))).toEqual({ ok: false, reason: "owner_only" });
    expect(checkTransition("NO_SHOW", "CONFIRMED", ctx(now, true))).toEqual({ ok: true, correction: true });
    expect(allowedNextStatuses("COMPLETED", false)).toEqual([]);
    expect(allowedNextStatuses("COMPLETED", true)).toEqual(["IN_PROGRESS"]);
  });
});

describe("BR-B3 no-show grace period", () => {
  it("blocks NO_SHOW before start + grace", () => {
    expect(checkTransition("CONFIRMED", "NO_SHOW", ctx("2026-10-15T10:44:59Z"))).toEqual({
      ok: false,
      reason: "too_early_for_no_show",
    });
  });
  it("allows NO_SHOW once the grace period has passed", () => {
    expect(checkTransition("CONFIRMED", "NO_SHOW", ctx("2026-10-15T10:45:00Z")).ok).toBe(true);
  });
});
