"use client";

// Finds an existing customer as staff type a phone number or name (US-08 AC1, US-09 AC1).
import { useEffect, useState, useTransition } from "react";
import { inputClass, labelClass } from "@/components/ui";
import { lookupCustomersAction } from "./actions";

export type Picked = { id: string; name: string } | null;

export function CustomerPicker({
  mode,
  onPick,
  picked,
  phone,
  setPhone,
}: {
  mode: "phone" | "any";
  picked: Picked;
  onPick: (c: Picked) => void;
  phone: string;
  setPhone: (v: string) => void;
}) {
  const [matches, setMatches] = useState<{ id: string; name: string; detail: string }[]>([]);
  const [, start] = useTransition();

  useEffect(() => {
    if (picked || phone.trim().length < 3) return;
    const t = setTimeout(() => start(async () => setMatches(await lookupCustomersAction(phone))), 250);
    return () => clearTimeout(t);
  }, [phone, picked]);

  if (picked) {
    return (
      <div className="flex items-center justify-between rounded-xl border-2 border-brand-900 bg-brand-50 px-4 py-3">
        <span>
          <span className="block font-semibold">{picked.name}</span>
          <span className="block text-sm text-ink-muted">Existing customer</span>
        </span>
        <button type="button" onClick={() => onPick(null)} className="text-sm font-semibold text-brand-900 underline">
          Change
        </button>
      </div>
    );
  }
  return (
    <div>
      <label className={labelClass} htmlFor="phone">
        {mode === "phone" ? "Phone number" : "Phone number or name"}
      </label>
      <input
        id="phone"
        name="phone"
        type={mode === "phone" ? "tel" : "text"}
        inputMode={mode === "phone" ? "tel" : "text"}
        autoComplete="off"
        autoFocus
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setMatches([]);
        }}
        className={inputClass}
        required
      />
      {phone.trim().length >= 3 && matches.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Matching customers">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick({ id: m.id, name: m.name })}
                className="flex w-full justify-between rounded-xl border border-border bg-card px-4 py-2 text-left"
              >
                <span className="font-semibold">{m.name}</span>
                <span className="text-sm text-ink-muted">{m.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
