"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, goldButton } from "@/components/ui";
import { MARKETING_CONSENT_WORDING, UTILITY_CONSENT_WORDING } from "@/domain/consent-wording";
import { formatMoney } from "@/domain/money";
import { walkInAction } from "../actions";
import { CustomerPicker, type Picked } from "../customer-picker";
import { Flash } from "../ui-client";

type Props = {
  services: { id: string; name: string; priceMinor: number }[];
  barbers: { id: string; name: string }[];
  isBarber: boolean;
  currency: string;
};

export function WalkInForm({ services, barbers, isBarber, currency }: Props) {
  const [state, action] = useActionState(walkInAction, null);
  const [picked, setPicked] = useState<Picked>(null);
  const [phone, setPhone] = useState("");
  const [paidNow, setPaidNow] = useState(false);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <Flash state={state} />
        {/* A fresh page load resets both the form and the action state. */}
        <button type="button" className={goldButton} onClick={() => location.reload()}>
          Record another walk-in
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <Flash state={state} />
      <CustomerPicker mode="phone" picked={picked} onPick={setPicked} phone={phone} setPhone={setPhone} />
      {picked && <input type="hidden" name="customerId" value={picked.id} />}
      {!picked && (
        <div>
          <label className={labelClass} htmlFor="name">
            Name <span className="font-normal text-ink-muted">(new customer)</span>
          </label>
          <input id="name" name="name" autoComplete="off" className={inputClass} />
        </div>
      )}

      <fieldset>
        <legend className={labelClass}>Service</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {services.map((s, i) => (
            <label key={s.id} className="cursor-pointer">
              <input type="radio" name="serviceId" value={s.id} defaultChecked={i === 0} className="peer sr-only" />
              <span className="block rounded-xl border border-border bg-card px-3 py-2 peer-checked:border-2 peer-checked:border-brand-900 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-900">
                <span className="block font-semibold">{s.name}</span>
                <span className="block text-sm text-ink-muted">{formatMoney(s.priceMinor, currency)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {!isBarber && (
        <fieldset>
          <legend className={labelClass}>Barber</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {[{ id: "any", name: "Any free" }, ...barbers].map((b, i) => (
              <label key={b.id} className="cursor-pointer">
                <input type="radio" name="barber" value={b.id} defaultChecked={i === 0} className="peer sr-only" />
                <span className="block rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold peer-checked:border-2 peer-checked:border-brand-900 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-900">
                  {b.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="rounded-xl border border-border bg-card p-3">
        <label className="flex items-center justify-between">
          <span className="font-semibold">Paid now</span>
          <input type="checkbox" name="paidNow" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} className="size-6 accent-brand-900" />
        </label>
        {paidNow && (
          <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Payment method">
            {["CASH", "TRANSFER", "POS", "CARD"].map((m, i) => (
              <label key={m} className="cursor-pointer">
                <input type="radio" name="method" value={m} defaultChecked={i === 0} className="peer sr-only" />
                <span className="block rounded-lg border border-border py-1.5 text-center text-sm font-semibold peer-checked:border-2 peer-checked:border-brand-900 peer-checked:bg-brand-50">
                  {m === "TRANSFER" ? "Transfer" : m === "CASH" ? "Cash" : m}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* US-09 AC3: consent boxes, never pre-ticked, with a line staff can read out. */}
      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-3">
        <legend className="px-1 text-sm font-semibold">Ask the customer</legend>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="utility" className="mt-0.5 size-5 accent-brand-900" />
          <span>
            &ldquo;Can we send your booking details and reminders on WhatsApp?&rdquo;
            <span className="block text-xs text-ink-muted">{UTILITY_CONSENT_WORDING}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="marketing" className="mt-0.5 size-5 accent-brand-900" />
          <span>
            &ldquo;And the occasional offer, or a nudge when you&apos;re due?&rdquo;
            <span className="block text-xs text-ink-muted">{MARKETING_CONSENT_WORDING}</span>
          </span>
        </label>
      </fieldset>

      <SubmitButton className={goldButton} pendingText="Saving…">
        Save walk-in
      </SubmitButton>
    </form>
  );
}
