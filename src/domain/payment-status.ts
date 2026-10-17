// Payment status is derived from the immutable payment ledger (BR-P1, BR-P2).

export type PaymentStatus = "UNPAID" | "PART_PAID" | "PAID" | "REFUNDED";

export type PaymentRow = {
  kind: "PAYMENT" | "REFUND" | "ADJUSTMENT";
  /** PAYMENT and REFUND are positive; ADJUSTMENT is signed. */
  amountMinor: number;
};

export type PaymentSummary = {
  status: PaymentStatus;
  paidMinor: number;
  balanceMinor: number;
};

export function derivePaymentStatus(priceMinor: number, rows: readonly PaymentRow[]): PaymentSummary {
  let paid = 0;
  let hasRefund = false;
  for (const row of rows) {
    if (row.kind === "PAYMENT") paid += row.amountMinor;
    else if (row.kind === "REFUND") {
      paid -= row.amountMinor;
      hasRefund = true;
    } else paid += row.amountMinor;
  }

  const balanceMinor = Math.max(priceMinor - paid, 0);
  let status: PaymentStatus;
  if (hasRefund && paid <= 0) status = "REFUNDED";
  else if (priceMinor <= 0 || paid >= priceMinor) status = "PAID";
  else if (paid > 0) status = "PART_PAID";
  else status = "UNPAID";

  return { status, paidMinor: paid, balanceMinor };
}
