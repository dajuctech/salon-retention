"use client";

import { useActionState, useState, useTransition } from "react";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import type { BookingStatus } from "@/domain/booking-status";
import { WEEKDAY_SHORT, formatTime } from "@/domain/format";
import { formatMoney, minorUnitDigits } from "@/domain/money";
import type { DayOption, SlotOption } from "@/server/slots";
import {
  bookingStatusAction,
  paymentLinkAction,
  recordPaymentAction,
  redeemLoyaltyAction,
  refundAction,
  rescheduleAction,
  staffSlotsAction,
  type ActionState,
  type LinkState,
} from "../../actions";
import { ActionButton, CopyLink, Flash } from "../../ui-client";

const LABEL: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirm",
  IN_PROGRESS: "Start · In chair",
  COMPLETED: "Mark done",
  CANCELLED: "Cancel booking",
  NO_SHOW: "No-show",
};

export function BookingStatusActions({ bookingId, next }: { bookingId: string; next: BookingStatus[] }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const run = (to: BookingStatus) => {
    if (to === "CANCELLED" && !window.confirm("Cancel this booking? Its reminders will stop.")) return;
    start(async () => setState(await bookingStatusAction(bookingId, to)));
  };
  return (
    <div className="space-y-2">
      <Flash state={state?.error ? state : null} />
      <div className="grid grid-cols-2 gap-2">
        {next.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => run(to)}
            className={to === "CANCELLED" || to === "NO_SHOW" ? `${outlineButton} text-status-danger-ink` : primaryButton}
          >
            {LABEL[to]}
          </button>
        ))}
      </div>
    </div>
  );
}

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "POS", label: "POS" },
  { value: "CARD", label: "Card" },
];

export function PaymentPanel({
  bookingId,
  currency,
  balanceMinor,
  paidMinor,
  canPay,
  canRefund,
  freeCutAvailable,
}: {
  bookingId: string;
  currency: string;
  balanceMinor: number;
  paidMinor: number;
  canPay: boolean;
  canRefund: boolean;
  freeCutAvailable: boolean;
}) {
  const unit = 10 ** minorUnitDigits(currency);
  const [state, action] = useActionState(recordPaymentAction.bind(null, bookingId), null);
  const [refundState, refund] = useActionState(refundAction.bind(null, bookingId), null);
  const [showRefund, setShowRefund] = useState(false);
  return (
    <Card className="space-y-4 p-4">
      {canPay && (
        <form action={action} className="space-y-3">
          <h2 className="text-lg font-bold">Record payment</h2>
          <Flash state={state} />
          <fieldset>
            <legend className={labelClass}>How did they pay?</legend>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {METHODS.map((m, i) => (
                <label key={m.value} className="cursor-pointer">
                  <input type="radio" name="method" value={m.value} defaultChecked={i === 0} className="peer sr-only" />
                  <span className="block rounded-xl border border-border bg-card py-2 text-center text-sm font-semibold peer-checked:border-2 peer-checked:border-brand-900 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-900">
                    {m.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="amount">
                Amount
              </label>
              <input id="amount" name="amount" type="number" inputMode="decimal" step={1 / unit} min={1 / unit} max={balanceMinor / unit} defaultValue={balanceMinor / unit} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass} htmlFor="reference">
                Reference <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input id="reference" name="reference" className={inputClass} maxLength={80} />
            </div>
          </div>
          <SubmitButton className={primaryButton} pendingText="Saving…">
            {paidMinor > 0 ? `Collect balance · ${formatMoney(balanceMinor, currency)}` : `Mark as paid · ${formatMoney(balanceMinor, currency)}`}
          </SubmitButton>
          {freeCutAvailable && (
            <ActionButton action={() => redeemLoyaltyAction(bookingId)} className={outlineButton} confirm="Use the customer's free cut on this booking?">
              Use free cut (loyalty reward)
            </ActionButton>
          )}
        </form>
      )}
      {canRefund && (
        <div>
          {!showRefund ? (
            <button type="button" onClick={() => setShowRefund(true)} className="text-sm font-semibold text-status-danger-ink underline">
              Refund or correct a payment
            </button>
          ) : (
            <form action={refund} className="space-y-3">
              <h2 className="text-lg font-bold">Refund</h2>
              <Flash state={refundState} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="ramount">
                    Amount
                  </label>
                  <input id="ramount" name="amount" type="number" inputMode="decimal" step={1 / unit} min={1 / unit} max={paidMinor / unit} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass} htmlFor="reason">
                    Reason
                  </label>
                  <input id="reason" name="reason" className={inputClass} required maxLength={200} />
                </div>
              </div>
              <SubmitButton className={`${outlineButton} text-status-danger-ink`} pendingText="Saving…">
                Record refund
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

export function ReschedulePanel({
  bookingId,
  serviceId,
  barberId,
  barbers,
  days,
  timeZone,
  currentStart,
}: {
  bookingId: string;
  serviceId: string;
  barberId: string;
  barbers: { id: string; displayName: string }[];
  days: DayOption[];
  timeZone: string;
  currentStart: string;
}) {
  const [open, setOpen] = useState(false);
  const [barber, setBarber] = useState(barberId);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const [state, action] = useActionState(rescheduleAction.bind(null, bookingId), null);

  const load = (b: string, d: string) => {
    setSlot(null);
    start(async () => setSlots(await staffSlotsAction(serviceId, b, d, bookingId)));
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={outlineButton}>
        Reschedule
      </button>
    );
  }
  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <h2 className="text-lg font-bold">Move booking</h2>
        <Flash state={state} />
        <input type="hidden" name="startsAt" value={slot ?? ""} />
        <input type="hidden" name="barber" value={barber} />
        {barbers.length > 1 && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Barber">
            {[{ id: "any", displayName: "Any free" }, ...barbers].map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={barber === b.id}
                onClick={() => {
                  setBarber(b.id);
                  if (dateKey) load(b.id, dateKey);
                }}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${barber === b.id ? "border-brand-900 bg-brand-50" : "border-border bg-card"}`}
              >
                {b.displayName}
              </button>
            ))}
          </div>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Date">
          {days.map((d, i) => (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={d.key === dateKey}
              disabled={d.closed}
              onClick={() => {
                setDateKey(d.key);
                load(barber, d.key);
              }}
              className={`min-w-[18%] shrink-0 rounded-xl border py-1.5 text-center ${d.key === dateKey ? "border-brand-900 bg-brand-900 text-white" : "border-border bg-card disabled:opacity-40"}`}
            >
              <span className="block text-xs">{i === 0 ? "Today" : WEEKDAY_SHORT[d.weekday]}</span>
              <span className="block text-lg font-bold">{d.day}</span>
            </button>
          ))}
        </div>
        {dateKey && (
          <div className={`grid grid-cols-4 gap-2 ${loading ? "opacity-50" : ""}`} role="radiogroup" aria-label="Time">
            {slots.map((s) => {
              const available = s.available && s.iso !== currentStart;
              return (
                <button
                  key={s.iso}
                  type="button"
                  role="radio"
                  aria-checked={slot === s.iso}
                  aria-label={`${formatTime(s.iso, timeZone)}${available ? "" : ", unavailable"}`}
                  disabled={!available}
                  onClick={() => setSlot(s.iso)}
                  className={`rounded-xl py-2 text-sm ${!available ? "bg-status-done text-ink-muted line-through" : slot === s.iso ? "border-2 border-brand-900 bg-brand-50 font-semibold" : "border border-border bg-card"}`}
                >
                  {formatTime(s.iso, timeZone)}
                </button>
              );
            })}
            {!loading && slots.every((s) => !s.available) && <p className="col-span-4 text-sm text-ink-muted">No free times that day.</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setOpen(false)} className={outlineButton}>
            Close
          </button>
          <SubmitButton className={primaryButton} pendingText="Moving…">
            Move booking
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

/** US-17: a payment link the customer can open on their phone. */
export function PaymentLinkPanel({ bookingId }: { bookingId: string }) {
  const [state, setState] = useState<LinkState>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-lg font-bold">Pay online</h2>
      {!state?.url ? (
        <button type="button" disabled={pending} onClick={() => start(async () => setState(await paymentLinkAction(bookingId)))} className={outlineButton}>
          {pending ? "Creating link…" : "Create payment link"}
        </button>
      ) : (
        <>
          <CopyLink link={state.url} />
          {state.whatsapp && (
            <a href={state.whatsapp} target="_blank" rel="noreferrer" className={primaryButton}>
              Send on WhatsApp
            </a>
          )}
          <p className="text-xs text-ink-muted">The booking is marked paid automatically when the payment provider confirms it.</p>
        </>
      )}
      {state?.error && <Flash state={{ error: state.error }} />}
    </Card>
  );
}
