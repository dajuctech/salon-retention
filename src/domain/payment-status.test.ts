import { describe, expect, it } from "vitest";
import { derivePaymentStatus } from "./payment-status";

describe("BR-P1 payment status is derived from the ledger", () => {
  it("is UNPAID with no payments", () => {
    expect(derivePaymentStatus(300_000, [])).toEqual({ status: "UNPAID", paidMinor: 0, balanceMinor: 300_000 });
  });

  it("is PART_PAID with a balance (design: Uche ₦2,500 paid of ₦4,500)", () => {
    expect(derivePaymentStatus(450_000, [{ kind: "PAYMENT", amountMinor: 250_000 }])).toEqual({
      status: "PART_PAID",
      paidMinor: 250_000,
      balanceMinor: 200_000,
    });
  });

  it("is PAID when payments cover the price", () => {
    const rows = [
      { kind: "PAYMENT", amountMinor: 250_000 },
      { kind: "PAYMENT", amountMinor: 200_000 },
    ] as const;
    expect(derivePaymentStatus(450_000, rows).status).toBe("PAID");
  });

  it("is PAID for a free (loyalty) visit priced at 0", () => {
    expect(derivePaymentStatus(0, []).status).toBe("PAID");
  });
});

describe("BR-P2 corrections are new rows", () => {
  it("is REFUNDED when a refund cancels the payment", () => {
    const rows = [
      { kind: "PAYMENT", amountMinor: 300_000 },
      { kind: "REFUND", amountMinor: 300_000 },
    ] as const;
    expect(derivePaymentStatus(300_000, rows).status).toBe("REFUNDED");
  });

  it("applies signed adjustments", () => {
    const rows = [
      { kind: "PAYMENT", amountMinor: 350_000 },
      { kind: "ADJUSTMENT", amountMinor: -50_000 },
    ] as const;
    expect(derivePaymentStatus(300_000, rows)).toEqual({ status: "PAID", paidMinor: 300_000, balanceMinor: 0 });
  });
});
