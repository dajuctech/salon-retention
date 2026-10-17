"use client";

// Add / edit customer (US-07) and merge duplicates (US-08 AC2).
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { mergeAction, saveCustomerAction } from "../actions";
import { Flash } from "../ui-client";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Initial = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  preferredBarberId: string | null;
  preferredStyle: string | null;
  notes: string | null;
} | null;

export function CustomerForm({ initial, barbers, phonePlaceholder }: { initial: Initial; barbers: { id: string; name: string }[]; phonePlaceholder: string }) {
  const [state, action] = useActionState(saveCustomerAction.bind(null, initial?.id ?? null), null);
  return (
    <form action={action} className="space-y-4">
      <Flash state={state} />
      <Field label="Name" name="name" defaultValue={initial?.name} required autoComplete="off" />
      <Field label="Phone (WhatsApp)" name="phone" type="tel" defaultValue={initial?.phone} placeholder={phonePlaceholder} required />
      <Field label="Email (optional)" name="email" type="email" defaultValue={initial?.email ?? ""} />
      <fieldset>
        <legend className={labelClass}>Birthday (optional, no year)</legend>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <select name="birthDay" aria-label="Birthday day" defaultValue={initial?.birthDay ?? ""} className={inputClass}>
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <select name="birthMonth" aria-label="Birthday month" defaultValue={initial?.birthMonth ?? ""} className={inputClass}>
            <option value="">Month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <div>
        <label className={labelClass} htmlFor="preferredBarberId">
          Preferred barber
        </label>
        <select id="preferredBarberId" name="preferredBarberId" defaultValue={initial?.preferredBarberId ?? ""} className={inputClass}>
          <option value="">No preference</option>
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <Field label="Preferred style" name="preferredStyle" defaultValue={initial?.preferredStyle ?? ""} placeholder="e.g. Low fade, short on top" />
      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={initial?.notes ?? ""} className={inputClass} placeholder="e.g. Likes a quiet chair" />
      </div>
      {!initial && (
        <fieldset className="space-y-3 rounded-xl border border-border bg-card p-3">
          <legend className="px-1 text-sm font-semibold">Ask the customer</legend>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="utility" className="mt-0.5 size-5 accent-brand-900" />
            Agreed to booking details and reminders on WhatsApp
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="marketing" className="mt-0.5 size-5 accent-brand-900" />
            Agreed to occasional offers and return reminders
          </label>
        </fieldset>
      )}
      <SubmitButton className={primaryButton} pendingText="Saving…">
        {initial ? "Save changes" : "Add customer"}
      </SubmitButton>
    </form>
  );
}

export function MergeForm({ keepId, others }: { keepId: string; others: { id: string; label: string }[] }) {
  const [state, action] = useActionState(mergeAction.bind(null, keepId), null);
  if (others.length === 0) return null;
  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <h2 className="text-lg font-bold">Merge a duplicate</h2>
        <p className="text-sm text-ink-muted">Moves the other customer&apos;s visits, payments and messages here, then removes the duplicate.</p>
        <Flash state={state} />
        <select name="dropId" required className={inputClass} aria-label="Duplicate customer">
          <option value="">Choose the duplicate…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <SubmitButton className={outlineButton} pendingText="Merging…">
          Merge into this customer
        </SubmitButton>
      </form>
    </Card>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={labelClass} htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} className={inputClass} {...rest} />
    </div>
  );
}
