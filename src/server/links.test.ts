import { describe, expect, it } from "vitest";
import { bookingLinkExpiry, hashToken, newInviteToken, signBookingToken, verifyBookingToken } from "./links";

const exp = new Date("2026-10-20T12:00:00Z");

describe("US-11 signed booking links", () => {
  it("round-trips a valid token", () => {
    const token = signBookingToken("bk_123", exp);
    expect(verifyBookingToken(token, new Date("2026-10-19T00:00:00Z"))).toEqual({ bookingId: "bk_123" });
  });

  it("rejects a tampered booking id or signature", () => {
    const token = signBookingToken("bk_123", exp);
    const [, e, s] = token.split(".");
    expect(verifyBookingToken(`bk_999.${e}.${s}`, new Date("2026-10-19T00:00:00Z"))).toBeNull();
    expect(verifyBookingToken(`${token.slice(0, -1)}x`, new Date("2026-10-19T00:00:00Z"))).toBeNull();
    expect(verifyBookingToken("garbage", new Date("2026-10-19T00:00:00Z"))).toBeNull();
  });

  it("rejects a token with a pushed-out expiry", () => {
    const token = signBookingToken("bk_123", exp);
    const [id, , s] = token.split(".");
    const later = Math.floor(new Date("2030-01-01").getTime() / 1000).toString(36);
    expect(verifyBookingToken(`${id}.${later}.${s}`, new Date("2026-10-19T00:00:00Z"))).toBeNull();
  });

  it("expires after the expiry time", () => {
    const token = signBookingToken("bk_123", exp);
    expect(verifyBookingToken(token, new Date("2026-10-20T12:00:01Z"))).toBeNull();
  });

  it("stays valid until a day after the appointment ends", () => {
    expect(bookingLinkExpiry(new Date("2026-10-15T11:00:00Z"))).toEqual(new Date("2026-10-16T11:00:00Z"));
  });
});

describe("US-03 invitation tokens", () => {
  it("are random and only the hash is meant to be stored", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });
});

describe("US-10 AC4 bot protection token", () => {
  const shown = new Date("2026-10-16T10:00:00Z");
  it("accepts a normal submission and rejects instant, stale or forged ones", async () => {
    const { signFormToken, checkFormToken } = await import("./links");
    const t = signFormToken(shown);
    expect(checkFormToken(t, new Date(shown.getTime() + 15_000))).toBe("ok");
    expect(checkFormToken(t, new Date(shown.getTime() + 500))).toBe("too_fast");
    expect(checkFormToken(t, new Date(shown.getTime() + 3 * 3600_000))).toBe("expired");
    const [p, ts] = t.split(".");
    const earlier = (shown.getTime() - 60_000).toString(36);
    expect(checkFormToken(`${p}.${earlier}.${t.split(".")[2]}`, new Date(shown.getTime() + 15_000))).toBe("invalid");
    expect(checkFormToken("nonsense", shown)).toBe("invalid");
    void ts;
  });
});
