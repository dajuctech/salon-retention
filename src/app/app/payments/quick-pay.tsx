"use client";

// "Mark as paid" / "Collect balance" (design p8) opens a method picker, as the review asked:
// the payment-method breakdown needs to know how each payment was made.
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import { outlineButton, primaryButton } from "@/components/ui";
import { formatMoney, minorUnitDigits } from "@/domain/money";
import { recordPaymentAction, redeemLoyaltyAction } from "../actions";
import { ActionButton, Flash } from "../ui-client";

export function QuickPay({ bookingId, amount, currency, part, freeCut }: { bookingId: string; amount: number; currency: string; part: boolean; freeCut: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(recordPaymentAction.bind(null, bookingId), null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={primaryButton}>
        {part ? "Collect balance" : "Mark as paid"}
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <Flash state={state} />
      <input type="hidden" name="amount" value={amount / 10 ** minorUnitDigits(currency)} />
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Payment method">
        {["CASH", "TRANSFER", "POS", "CARD"].map((m, i) => (
          <label key={m} className="cursor-pointer">
            <input type="radio" name="method" value={m} defaultChecked={i === 0} className="peer sr-only" />
            <span className="block rounded-xl border border-border bg-card py-2 text-center text-sm font-semibold peer-checked:border-2 peer-checked:border-brand-900 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-900">
              {m === "CASH" ? "Cash" : m === "TRANSFER" ? "Transfer" : m === "POS" ? "POS" : "Card"}
            </span>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className={outlineButton}>
          Back
        </button>
        <SubmitButton className={primaryButton} pendingText="Saving…">
          Paid {formatMoney(amount, currency)}
        </SubmitButton>
      </div>
      {freeCut && (
        <ActionButton action={() => redeemLoyaltyAction(bookingId)} className={outlineButton} confirm="Use the customer's free cut?">
          Use free cut instead
        </ActionButton>
      )}
    </form>
  );
}
