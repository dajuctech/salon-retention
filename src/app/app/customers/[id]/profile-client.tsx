"use client";

import { useState, useTransition } from "react";
import { Card, outlineButton } from "@/components/ui";
import { anonymiseAction, consentAction, type ActionState } from "../../actions";
import { Flash } from "../../ui-client";

export function ConsentToggles({ customerId, utility, marketing }: { customerId: string; utility: boolean; marketing: boolean }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const toggle = (purpose: "UTILITY" | "MARKETING", granted: boolean) =>
    start(async () => setState(await consentAction(customerId, purpose, granted)));
  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold">WhatsApp permission</h2>
      <p className="mt-1 text-sm text-ink-muted">Change only when the customer asks you to. Every change is recorded.</p>
      <div className="mt-3 space-y-3" aria-busy={pending}>
        <Row label="Booking details and reminders" on={utility} disabled={pending} onChange={(v) => toggle("UTILITY", v)} />
        <Row label="Offers and return reminders" on={marketing} disabled={pending} onChange={(v) => toggle("MARKETING", v)} />
      </div>
      {state?.error && <div className="mt-2"><Flash state={state} /></div>}
    </Card>
  );
}

function Row({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-6 accent-brand-900" />
    </label>
  );
}

export function DataRights({ customerId, name }: { customerId: string; name: string }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold">Customer data</h2>
      <p className="mt-1 text-sm text-ink-muted">When a customer asks for their data, or asks you to delete it.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`/app/customers/${customerId}/export`} className={outlineButton}>
          Export data
        </a>
        <button
          type="button"
          disabled={pending}
          className={`${outlineButton} text-status-danger-ink`}
          onClick={() => {
            if (!window.confirm(`Delete ${name}'s personal data? Their bookings and payments stay for your records, without their name or number. This can't be undone.`)) return;
            start(async () => setState(await anonymiseAction(customerId)));
          }}
        >
          {pending ? "Deleting…" : "Delete data"}
        </button>
      </div>
      <Flash state={state} />
    </Card>
  );
}
