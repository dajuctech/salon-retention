import { describe, expect, it } from "vitest";
import { loyaltyStatus } from "./loyalty";
import { formatMoney, minorUnitDigits, toMinor } from "./money";
import { normalizePhone } from "./phone";

describe("BR-I1 phone normalisation", () => {
  it("normalises Nigerian local and international formats to the same E.164", () => {
    expect(normalizePhone("0803 123 4567", "NG")).toEqual({ ok: true, e164: "+2348031234567" });
    expect(normalizePhone("+234 803 123 4567", "NG")).toEqual({ ok: true, e164: "+2348031234567" });
    expect(normalizePhone("234-803-123-4567", "NG")).toEqual({ ok: true, e164: "+2348031234567" });
  });

  it("uses the salon's country as default region", () => {
    expect(normalizePhone("07911 123456", "GB")).toEqual({ ok: true, e164: "+447911123456" });
  });

  it("rejects invalid numbers", () => {
    expect(normalizePhone("12345", "NG")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("", "NG")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("BR-M1 money in minor units", () => {
  it("knows currency minor units", () => {
    expect(minorUnitDigits("NGN")).toBe(2);
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(toMinor(3000, "NGN")).toBe(300_000);
  });

  it("formats like the design (₦3,000) and keeps pence when present", () => {
    expect(formatMoney(300_000, "NGN")).toBe("₦3,000");
    expect(formatMoney(1250, "GBP")).toBe("£12.50");
  });

  it("refuses non-integer amounts", () => {
    expect(() => formatMoney(10.5, "NGN")).toThrow();
  });
});

describe("BR-L1–L4 loyalty punch card", () => {
  it("shows progress (design: 8 of 10 cuts)", () => {
    expect(loyaltyStatus(8, 0, 10)).toEqual({ stamps: 8, threshold: 10, rewardAvailable: false });
  });

  it("makes a reward available at the threshold", () => {
    expect(loyaltyStatus(10, 0, 10).rewardAvailable).toBe(true);
  });

  it("carries extra stamps over after redemption (BR-L3)", () => {
    expect(loyaltyStatus(12, 1, 10)).toEqual({ stamps: 2, threshold: 10, rewardAvailable: false });
  });

  it("rejects a zero threshold", () => {
    expect(() => loyaltyStatus(1, 0, 0)).toThrow();
  });
});

describe("formatPhone", () => {
  it("shows numbers the way people write them (design p7)", async () => {
    const { formatPhone } = await import("./phone");
    expect(formatPhone("+2348025550147")).toBe("+234 802 555 0147");
    expect(formatPhone("not a number")).toBe("not a number");
  });
});
