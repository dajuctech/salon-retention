"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, primaryButton } from "@/components/ui";
import { WEEKDAY_SHORT, formatTime } from "@/domain/format";
import { formatMoney } from "@/domain/money";
import type { DayOption, SlotOption } from "@/server/slots";
import { createBookingAction, staffSlotsAction } from "../../actions";
import { CustomerPicker, type Picked } from "../../customer-picker";
import { Flash } from "../../ui-client";

type Props = {
  services: { id: string; name: string; durationMin: number; priceMinor: number }[];
  barbers: { id: string; name: string }[];
  days: DayOption[];
  initialDate: string;
  initialCustomer: { id: string; name: string } | null;
  isBarber: boolean;
  currency: string;
  timeZone: string;
};

export function NewBookingForm({ services, barbers, days, initialDate, initialCustomer, isBarber, currency, timeZone }: Props) {
  const [state, action] = useActionState(createBookingAction, null);
  const [picked, setPicked] = useState<Picked>(initialCustomer);
  const [query, setQuery] = useState("");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [barber, setBarber] = useState(isBarber ? (barbers[0]?.id ?? "") : "any");
  const [dateKey, setDateKey] = useState(initialDate);
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!serviceId) return;
    start(async () => {
      const fresh = await staffSlotsAction(serviceId, barber, dateKey);
      setSlots(fresh);
      setSlot((cur) => (fresh.some((s) => s.iso === cur && s.available) ? cur : null));
    });
  }, [serviceId, barber, dateKey]);

  if (services.length === 0) {
    return <p className="rounded-2xl bg-card p-6 text-center text-ink-muted">Add a service in Settings first.</p>;
  }

  return (
    <form action={action} className="space-y-5">
      <Flash state={state} />
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="barber" value={barber} />
      <input type="hidden" name="startsAt" value={slot ?? ""} />
      {picked && <input type="hidden" name="customerId" value={picked.id} />}

      <section className="space-y-3">
        <h2 className="font-bold">Customer</h2>
        <CustomerPicker mode="any" picked={picked} onPick={setPicked} phone={query} setPhone={setQuery} />
        {!picked && (
          <div>
            <label className={labelClass} htmlFor="name">
              Name <span className="font-normal text-ink-muted">(if new)</span>
            </label>
            <input id="name" name="name" className={inputClass} />
            <p className="mt-1 text-sm text-ink-muted">For a new customer, type their phone number above and their name here.</p>
          </div>
        )}
      </section>

      <fieldset>
        <legend className="font-bold">Service</legend>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Service">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={serviceId === s.id}
              onClick={() => setServiceId(s.id)}
              className={`rounded-xl px-3 py-2 text-left ${serviceId === s.id ? "border-2 border-brand-900 bg-brand-50" : "border border-border bg-card"}`}
            >
              <span className="block font-semibold">{s.name}</span>
              <span className="block text-sm text-ink-muted">
                {s.durationMin} min · {formatMoney(s.priceMinor, currency)}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {!isBarber && (
        <fieldset>
          <legend className="font-bold">Barber</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Barber">
            {[{ id: "any", name: "Any free" }, ...barbers].map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={barber === b.id}
                onClick={() => setBarber(b.id)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${barber === b.id ? "border-2 border-brand-900 bg-brand-50" : "border-border bg-card"}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="font-bold">Date and time</legend>
        <div className="-mx-5 mt-2 flex gap-2 overflow-x-auto px-5" role="radiogroup" aria-label="Date">
          {days.map((d, i) => (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={d.key === dateKey}
              disabled={d.closed}
              onClick={() => setDateKey(d.key)}
              className={`min-w-[18%] shrink-0 rounded-xl border py-1.5 text-center ${d.key === dateKey ? "border-brand-900 bg-brand-900 text-white" : "border-border bg-card disabled:opacity-40"}`}
            >
              <span className="block text-xs">{i === 0 ? "Today" : WEEKDAY_SHORT[d.weekday]}</span>
              <span className="block text-lg font-bold">{d.day}</span>
            </button>
          ))}
        </div>
        <div className={`mt-3 grid grid-cols-4 gap-2 ${loading ? "opacity-50" : ""}`} role="radiogroup" aria-label="Time" aria-busy={loading}>
          {slots.map((s) => (
            <button
              key={s.iso}
              type="button"
              role="radio"
              aria-checked={slot === s.iso}
              aria-label={`${formatTime(s.iso, timeZone)}${s.available ? "" : ", unavailable"}`}
              disabled={!s.available}
              onClick={() => setSlot(s.iso)}
              className={`rounded-xl py-2 text-sm ${!s.available ? "bg-status-done text-ink-muted line-through" : slot === s.iso ? "border-2 border-brand-900 bg-brand-50 font-semibold" : "border border-border bg-card"}`}
            >
              {formatTime(s.iso, timeZone)}
            </button>
          ))}
          {!loading && slots.every((s) => !s.available) && <p className="col-span-4 text-sm text-ink-muted">No free times that day.</p>}
        </div>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input id="notes" name="notes" maxLength={200} className={inputClass} />
      </div>

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

      <SubmitButton className={primaryButton} pendingText="Booking…">
        Book it
      </SubmitButton>
    </form>
  );
}
