"use client";

// US-11: customer reschedules or cancels from their signed link (BR-B4, BR-B6).
import { useState, useTransition } from "react";
import { WEEKDAY_SHORT, formatTime } from "@/domain/format";
import type { DayOption, SlotOption } from "@/server/slots";
import { cancelBookingAction, payNowAction, rescheduleBookingAction, rescheduleSlotsAction } from "../../actions";

type Props = { slug: string; token: string; timeZone: string; days: DayOption[]; currentStart: string };

export function ManageBooking({ slug, token, timeZone, days, currentStart }: Props) {
  const [mode, setMode] = useState<"idle" | "reschedule" | "cancel">("idle");
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pickDay(key: string) {
    setDateKey(key);
    setSlot(null);
    start(async () => setSlots(await rescheduleSlotsAction(slug, token, key)));
  }

  if (mode === "idle") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setMode("reschedule")} className="rounded-2xl border border-border bg-card py-3 font-semibold">
          Reschedule
        </button>
        <button type="button" onClick={() => setMode("cancel")} className="rounded-2xl border border-border bg-card py-3 font-semibold">
          Cancel
        </button>
      </div>
    );
  }

  if (mode === "cancel") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4" role="alertdialog" aria-labelledby="cancel-title">
        <p id="cancel-title" className="font-semibold">
          Cancel this booking?
        </p>
        <p className="mt-1 text-sm text-ink-muted">The time will be freed up for someone else.</p>
        {error && <p role="alert" className="mt-2 text-sm text-status-danger-ink">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setMode("idle")} className="rounded-xl border border-border py-3 font-semibold">
            Keep it
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await cancelBookingAction(slug, token);
                if (result?.error) setError(result.error);
              })
            }
            className="rounded-xl bg-status-danger-ink py-3 font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Cancelling…" : "Yes, cancel"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-semibold">Pick a new time</p>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="New date">
        {days.map((d, i) => (
          <button
            key={d.key}
            type="button"
            role="radio"
            aria-checked={d.key === dateKey}
            disabled={d.closed}
            onClick={() => pickDay(d.key)}
            className={`min-w-[18%] shrink-0 rounded-xl border py-2 text-center ${d.key === dateKey ? "border-brand-900 bg-brand-900 text-white" : "border-border bg-card disabled:opacity-40"}`}
          >
            <span className="block text-sm">{i === 0 ? "Today" : WEEKDAY_SHORT[d.weekday]}</span>
            <span className="block text-xl font-bold">{d.day}</span>
          </button>
        ))}
      </div>
      {dateKey && (
        <div className={`mt-3 grid grid-cols-3 gap-2 ${pending ? "opacity-50" : ""}`} role="radiogroup" aria-label="New time">
          {slots.map((s) => {
            const isCurrent = s.iso === currentStart;
            const available = s.available && !isCurrent;
            return (
              <button
                key={s.iso}
                type="button"
                role="radio"
                aria-checked={s.iso === slot}
                aria-label={`${formatTime(s.iso, timeZone)}${available ? "" : ", unavailable"}`}
                disabled={!available}
                onClick={() => setSlot(s.iso)}
                className={`rounded-xl py-2.5 ${!available ? "bg-status-done text-ink-muted line-through" : s.iso === slot ? "border-2 border-brand-900 bg-brand-50 font-semibold" : "border border-border bg-card"}`}
              >
                {formatTime(s.iso, timeZone)}
              </button>
            );
          })}
          {!pending && slots.every((s) => !s.available) && (
            <p className="col-span-3 text-sm text-ink-muted">No free times that day. Try another date.</p>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-status-danger-ink">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setMode("idle")} className="rounded-xl border border-border py-3 font-semibold">
          Back
        </button>
        <button
          type="button"
          disabled={!slot || pending}
          onClick={() =>
            start(async () => {
              const result = await rescheduleBookingAction(slug, token, slot!);
              if (result?.error) {
                setError(result.error);
                if (dateKey) setSlots(await rescheduleSlotsAction(slug, token, dateKey));
              }
            })
          }
          className="rounded-xl bg-brand-900 py-3 font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Move booking"}
        </button>
      </div>
    </div>
  );
}

export function PayNow({ slug, token, label }: { slug: string; token: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await payNowAction(slug, token);
            if (r?.error) setError(r.error);
          })
        }
        className="w-full rounded-2xl bg-accent-500 py-3.5 text-lg font-semibold text-brand-900 disabled:opacity-70"
      >
        {pending ? "Opening checkout…" : label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-status-danger-ink">{error}</p>}
    </div>
  );
}
