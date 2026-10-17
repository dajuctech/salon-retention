"use client";

import { ArrowRight } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { formatMoney } from "@/domain/money";
import type { DayOption, SlotOption } from "@/server/booking";
import { createBookingAction, getSlotsAction, type BookingFormState } from "./actions";
import { WEEKDAY_SHORT, formatShortDate, formatTime, initials } from "@/domain/format";

const ANY = "any";
const UTILITY_NOTICE = "Your booking details and reminders arrive on WhatsApp.";
const MARKETING_LABEL = "Send me occasional offers and a nudge when I'm due for a cut.";

type Props = {
  slug: string;
  timeZone: string;
  currency: string;
  services: { id: string; name: string; durationMin: number; priceMinor: number }[];
  barbers: { id: string; name: string }[];
  days: DayOption[];
  initial: { serviceId: string; dateKey: string; slots: SlotOption[] };
  formToken: string;
};

export function BookingForm({ slug, timeZone, currency, services, barbers, days, initial, formToken }: Props) {
  const [serviceId, setServiceId] = useState(initial.serviceId);
  const [barber, setBarber] = useState(ANY);
  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [slots, setSlots] = useState(initial.slots);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Name and phone are uncontrolled so nothing typed or autofilled before the page finishes
  // loading (hydration) is wiped on slow phones; the state only drives the "what's missing" hint.
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Typed or autofilled before hydration: pick up what's already in the fields, once.
    if (nameRef.current?.value) setName(nameRef.current.value);
    if (phoneRef.current?.value) setPhone(phoneRef.current.value);
  }, []);
  const [marketing, setMarketing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [loadingSlots, startLoading] = useTransition();

  const [state, formAction, submitting] = useActionState<BookingFormState, FormData>(async (prev, formData) => {
    const result = await createBookingAction(slug, prev, formData);
    if (result?.code === "slot_taken") {
      setSlot(null);
      setHint(null);
      setSlots(await getSlotsAction(slug, serviceId, barber, dateKey));
    }
    return result;
  }, null);

  function choose(next: { serviceId?: string; barber?: string; dateKey?: string }) {
    const s = next.serviceId ?? serviceId;
    const b = next.barber ?? barber;
    const d = next.dateKey ?? dateKey;
    setServiceId(s);
    setBarber(b);
    setDateKey(d);
    startLoading(async () => {
      const fresh = await getSlotsAction(slug, s, b, d);
      setSlots(fresh);
      // Keep the chosen time if it still works; otherwise clear it and say why.
      if (slot && !fresh.some((x) => x.iso === slot && x.available)) {
        setSlot(null);
        setHint("That time isn't available for this choice. Please pick another.");
      }
    });
  }

  const service = services.find((s) => s.id === serviceId)!;
  const barberLabel = barber === ANY ? "Any barber" : barbers.find((b) => b.id === barber)?.name;
  const day = days.find((d) => d.key === dateKey);
  const missing = !slot
    ? { step: "step-3", text: "Pick a time first." }
    : name.trim().length < 2
      ? { step: "step-4", text: "Enter your name." }
      : phone.trim().length < 6
        ? { step: "step-4", text: "Enter your WhatsApp number." }
        : null;

  // The button always responds: if something is missing, say what and scroll to it.
  function onConfirmClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!missing) {
      setHint(null);
      return;
    }
    e.preventDefault();
    setHint(missing.text);
    document.getElementById(missing.step)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <form action={formAction} className="px-5 pb-44 pt-6">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="barber" value={barber} />
      <input type="hidden" name="startsAt" value={slot ?? ""} />
      <input type="hidden" name="formToken" value={formToken} />
      {/* Honeypot: hidden from people and screen readers; bots that fill every field are refused. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <Step n={1} title="Choose a service">
        <div className="space-y-3" role="radiogroup" aria-label="Service">
          {services.map((s) => (
            <Choice
              key={s.id}
              selected={s.id === serviceId}
              onSelect={() => choose({ serviceId: s.id })}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span>
                <span className="block font-semibold">{s.name}</span>
                <span className="block text-sm text-ink-muted">{s.durationMin} min</span>
              </span>
              <span className="text-lg font-bold">{formatMoney(s.priceMinor, currency)}</span>
            </Choice>
          ))}
        </div>
      </Step>

      <Step n={2} title="Pick your barber">
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Barber">
          <Choice selected={barber === ANY} onSelect={() => choose({ barber: ANY })} className="px-2 py-3">
            <Avatar label="Any" dark />
            <span className="mt-2 block text-sm font-medium">First free</span>
          </Choice>
          {barbers.map((b) => (
            <Choice key={b.id} selected={barber === b.id} onSelect={() => choose({ barber: b.id })} className="px-2 py-3">
              <Avatar label={initials(b.name)} decorative />
              <span className="mt-2 block text-sm font-medium">{b.name}</span>
            </Choice>
          ))}
        </div>
      </Step>

      <Step n={3} title="Date and time">
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1" role="radiogroup" aria-label="Date">
          {days.map((d, i) => {
            const selected = d.key === dateKey;
            return (
              <button
                key={d.key}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={d.closed}
                onClick={() => choose({ dateKey: d.key })}
                className={`min-w-[18%] shrink-0 rounded-xl border py-2 text-center transition ${
                  selected
                    ? "border-brand-900 bg-brand-900 text-white"
                    : "border-border bg-card text-ink disabled:opacity-40"
                }`}
              >
                <span className="block text-sm">{i === 0 ? "Today" : WEEKDAY_SHORT[d.weekday]}</span>
                <span className="block text-xl font-bold">{d.day}</span>
                {d.closed && <span className="sr-only">Closed</span>}
              </button>
            );
          })}
        </div>

        <div
          className={`mt-3 grid grid-cols-3 gap-3 transition-opacity ${loadingSlots ? "opacity-50" : ""}`}
          role="radiogroup"
          aria-label="Time"
          aria-busy={loadingSlots}
        >
          {slots.map((s) => {
            const selected = s.iso === slot;
            return (
              <button
                key={s.iso}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!s.available}
                aria-label={`${formatTime(s.iso, timeZone)}${s.available ? "" : ", unavailable"}`}
                disabled={!s.available}
                onClick={() => {
                  setSlot(s.iso);
                  setHint(null);
                }}
                className={`rounded-xl py-3 text-center text-lg transition ${
                  !s.available
                    ? "bg-status-done text-ink-muted line-through"
                    : selected
                      ? "border-2 border-brand-900 bg-brand-50 font-semibold"
                      : "border border-border bg-card"
                }`}
              >
                {formatTime(s.iso, timeZone)}
              </button>
            );
          })}
        </div>
        {!loadingSlots && slots.every((s) => !s.available) && (
          <p className="mt-3 rounded-xl bg-card p-4 text-sm text-ink-muted">
            {day?.closed ? "Closed on this day." : "Fully booked on this day. Try another date."}
          </p>
        )}
      </Step>

      <Step n={4} title="Your details">
        <label className="block text-sm font-semibold" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          ref={nameRef}
          defaultValue=""
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-lg outline-none focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20"
          required
        />
        <label className="mt-4 block text-sm font-semibold" htmlFor="phone">
          WhatsApp number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+234 801 234 5678"
          ref={phoneRef}
          defaultValue=""
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-lg outline-none focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20"
          required
        />
        <p className="mt-2 text-sm text-ink-muted">{UTILITY_NOTICE}</p>
        {/* Marketing consent is optional and never pre-ticked (US-18, BR-R1). */}
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="marketing"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 size-5 accent-brand-900"
          />
          <span>{MARKETING_LABEL}</span>
        </label>
      </Step>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card">
        <div className="mx-auto max-w-md px-5 pb-5 pt-3">
          {(hint ?? state?.error) && (
            <p role="alert" className="mb-2 rounded-lg bg-status-danger px-3 py-2 text-sm text-status-danger-ink">
              {hint ?? state?.error}
            </p>
          )}
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="truncate text-sm text-ink-muted">
              {service.name} · {barberLabel}
              {slot ? ` · ${formatShortDate(slot, timeZone)}, ${formatTime(slot, timeZone)}` : " · Pick a time"}
            </p>
            <p className="text-lg font-bold">{formatMoney(service.priceMinor, currency)}</p>
          </div>
          {missing && (
            <span id="booking-missing" className="sr-only">
              {missing.text}
            </span>
          )}
          <button
            type="submit"
            disabled={submitting}
            onClick={onConfirmClick}
            aria-describedby={missing ? "booking-missing" : undefined}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-900 py-4 text-lg font-semibold text-white transition disabled:cursor-wait`}
          >
            {submitting ? "Booking…" : "Confirm booking"}
            {!submitting && <ArrowRight className="size-5 text-accent-500" aria-hidden />}
          </button>
        </div>
      </div>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={`step-${n}`} className="mb-7 scroll-mt-4">
      <h2 className="mb-3 flex items-center gap-3 text-lg font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-accent-500 text-sm font-bold text-brand-900">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Choice({
  selected,
  onSelect,
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`rounded-2xl text-center transition ${
        selected ? "border-2 border-brand-900 bg-brand-50" : "border border-border bg-card"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** `decorative`: initials repeat the name beside them, so screen readers skip them ("Tunde", not "TU Tunde"). */
function Avatar({ label, dark = false, decorative = false }: { label: string; dark?: boolean; decorative?: boolean }) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={`mx-auto flex size-11 items-center justify-center rounded-full text-sm font-bold ${
        dark ? "bg-brand-900 text-white" : "bg-accent-50 text-[#7a5a12]"
      }`}
    >
      {label}
    </span>
  );
}
