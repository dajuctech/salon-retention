"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import {
  barberAction,
  closedDateAction,
  connectPaystackAction,
  disconnectPaymentAccountAction,
  endPromotionAction,
  hoursAction,
  inviteAction,
  memberAccessAction,
  paymentProviderAction,
  profileAction,
  promotionAction,
  removeClosedDateAction,
  revokeInviteAction,
  rulesAction,
  serviceAction,
  startStripeConnectAction,
  timeOffAction,
} from "../actions";
import { ActionButton, Flash } from "../ui-client";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
type Range = { weekday: number; startMin: number; endMin: number };

let nextRangeId = 0;

/** Opening or working hours: any number of time ranges per day (e.g. a lunch break). */
function HoursEditor({ hours }: { hours: Range[] }) {
  const [ranges, setRanges] = useState(() =>
    Object.fromEntries(
    ORDER.map((d) => {
      const day = hours.filter((h) => h.weekday === d).sort((a, b) => a.startMin - b.startMin);
      return [d, day.length ? day.map((h) => ({ id: nextRangeId++, s: h.startMin, e: h.endMin })) : [{ id: nextRangeId++, s: 9 * 60, e: 18 * 60 }]];
    }),
  ) as Record<number, { id: number; s: number; e: number }[]>,
  );
  const [on, setOn] = useState<Record<number, boolean>>(Object.fromEntries(ORDER.map((d) => [d, hours.some((h) => h.weekday === d)])));
  return (
    <div className="space-y-3">
      {ORDER.map((d) => (
        <div key={d} className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
          <label className="flex items-center gap-2 pt-1.5 font-semibold">
            <input type="checkbox" name={`d${d}on`} checked={on[d]} onChange={(e) => setOn({ ...on, [d]: e.target.checked })} className="size-5 accent-brand-900" />
            {DAYS[d]}
          </label>
          {on[d] ? (
            <div className="space-y-1.5">
              {ranges[d].map((r, i) => (
                // Stable keys: the time inputs are uncontrolled, so removing a row must not shift values.
                <div key={r.id} className="flex items-center gap-1.5">
                  <input type="time" name={`d${d}r${i}s`} defaultValue={hhmm(r.s)} aria-label={`${DAYS[d]} range ${i + 1} from`} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5" />
                  <span aria-hidden>–</span>
                  <input type="time" name={`d${d}r${i}e`} defaultValue={hhmm(r.e)} aria-label={`${DAYS[d]} range ${i + 1} to`} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5" />
                  {ranges[d].length > 1 && (
                    <button type="button" aria-label={`Remove ${DAYS[d]} range ${i + 1}`} onClick={() => setRanges({ ...ranges, [d]: ranges[d].filter((_, j) => j !== i) })} className="px-1 text-lg text-status-danger-ink">
                      ×
                    </button>
                  )}
                </div>
              ))}
              {ranges[d].length < 4 && (
                <button
                  type="button"
                  onClick={() => {
                    const last = ranges[d].at(-1)!;
                    setRanges({ ...ranges, [d]: [...ranges[d], { id: nextRangeId++, s: Math.min(last.e + 60, 22 * 60), e: Math.min(last.e + 120, 23 * 60) }] });
                  }}
                  className="text-sm font-semibold text-brand-900 underline"
                >
                  + Add hours (e.g. after a break)
                </button>
              )}
            </div>
          ) : (
            <p className="pt-1.5 text-sm text-ink-muted">Closed</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProfileForm({ name, whatsappNumber, timezone, bookingLink, timezones }: { name: string; whatsappNumber: string; timezone: string; bookingLink: string; timezones: string[] }) {
  const [state, action] = useActionState(profileAction, null);
  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <h2 className="text-lg font-bold">Salon profile</h2>
        <Flash state={state} />
        <div>
          <label className={labelClass} htmlFor="sname">Salon name</label>
          <input id="sname" name="name" defaultValue={name} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="wa">WhatsApp business number</label>
          <input id="wa" name="whatsappNumber" type="tel" defaultValue={whatsappNumber} className={inputClass} />
        </div>
        <div>
          <p className={labelClass}>Booking link</p>
          <p className="mt-1 break-all rounded-xl bg-surface px-4 py-3 text-ink-muted">{bookingLink}</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="tz">Timezone</label>
          <select id="tz" name="timezone" defaultValue={timezone} className={inputClass}>
            {timezones.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <SubmitButton className={primaryButton}>Save profile</SubmitButton>
      </form>
    </Card>
  );
}

type Service = { id: string; name: string; durationMin: number; bufferMin: number; price: number; returnReminderDays: number | null; loyaltyReward: boolean; active: boolean };

export function ServiceRow({ service, priceLabel }: { service: Service | null; priceLabel: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(serviceAction.bind(null, service?.id ?? null), null);
  if (!open) {
    return service ? (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex-1">
          <span className={`block font-semibold ${service.active ? "" : "text-ink-muted line-through"}`}>{service.name}</span>
          <span className="block text-sm text-ink-muted">{service.durationMin} min</span>
        </span>
        <span className="font-bold">{priceLabel}</span>
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-brand-900 underline">Edit</button>
      </div>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-accent-500 px-4 py-2 font-semibold text-brand-900">+ Add</button>
    );
  }
  return (
    <form action={action} className="space-y-3 p-4">
      <Flash state={state} />
      <div>
        <label className={labelClass} htmlFor={`sn-${service?.id ?? "new"}`}>Name</label>
        <input id={`sn-${service?.id ?? "new"}`} name="name" defaultValue={service?.name} required className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelClass} htmlFor={`sd-${service?.id ?? "new"}`}>Minutes</label>
          <input id={`sd-${service?.id ?? "new"}`} name="durationMin" type="number" min={5} max={480} defaultValue={service?.durationMin ?? 30} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sb-${service?.id ?? "new"}`}>Buffer</label>
          <input id={`sb-${service?.id ?? "new"}`} name="bufferMin" type="number" min={0} max={120} defaultValue={service?.bufferMin ?? 0} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sp-${service?.id ?? "new"}`}>Price</label>
          <input id={`sp-${service?.id ?? "new"}`} name="price" type="number" min={0} step="any" defaultValue={service?.price ?? ""} required className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor={`sr-${service?.id ?? "new"}`}>Return reminder after (days) <span className="font-normal text-ink-muted">· for customers with under 3 visits</span></label>
        <input id={`sr-${service?.id ?? "new"}`} name="returnReminderDays" type="number" min={7} max={90} defaultValue={service?.returnReminderDays ?? ""} placeholder="21" className={inputClass} />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" name="loyaltyReward" defaultChecked={service?.loyaltyReward} className="size-5 accent-brand-900" />
        Can be the free reward in the loyalty card
      </label>
      {service && (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="active" defaultChecked={service.active} className="size-5 accent-brand-900" />
          Offered (untick to hide it from booking)
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className={outlineButton}>Close</button>
        <SubmitButton className={primaryButton}>Save</SubmitButton>
      </div>
    </form>
  );
}

type Barber = { id: string; displayName: string; active: boolean; hasLogin: boolean; email: string | null; hours: Range[] };

export function BarberRow({ barber, canEditAll, summary }: { barber: Barber | null; canEditAll: boolean; summary: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(barberAction.bind(null, barber?.id ?? null), null);
  const [offState, off] = useActionState(timeOffAction.bind(null, barber?.id ?? ""), null);
  if (!open) {
    return barber ? (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-50 text-sm font-bold text-[#7a5a12]" aria-hidden>
          {barber.displayName.slice(0, 2).toUpperCase()}
        </span>
        <span className="flex-1">
          <span className={`block font-semibold ${barber.active ? "" : "text-ink-muted line-through"}`}>{barber.displayName}</span>
          <span className="block text-sm text-ink-muted">{summary}{barber.email ? ` · ${barber.email}` : ""}</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-brand-900 underline">Edit</button>
      </div>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-accent-500 px-4 py-2 font-semibold text-brand-900">+ Add</button>
    );
  }
  return (
    <div className="space-y-4 p-4">
      <form action={action} className="space-y-3">
        <Flash state={state} />
        <div>
          <label className={labelClass} htmlFor={`bn-${barber?.id ?? "new"}`}>Name shown to customers</label>
          <input id={`bn-${barber?.id ?? "new"}`} name="displayName" defaultValue={barber?.displayName} required disabled={!canEditAll && Boolean(barber)} className={inputClass} />
          {!canEditAll && barber && <input type="hidden" name="displayName" value={barber.displayName} />}
        </div>
        <p className={labelClass}>Working hours</p>
        <HoursEditor hours={barber?.hours ?? [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 540, endMin: 1080 }))} />
        {barber && canEditAll && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="active" defaultChecked={barber.active} className="size-5 accent-brand-900" />
            Taking bookings
          </label>
        )}
        {barber && !canEditAll && <input type="hidden" name="active" value="on" />}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setOpen(false)} className={outlineButton}>Close</button>
          <SubmitButton className={primaryButton}>Save</SubmitButton>
        </div>
      </form>
      {barber && (
        <form action={off} className="space-y-2 rounded-xl border border-border p-3">
          <p className="font-semibold">Time off</p>
          <Flash state={offState} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor={`to-s-${barber.id}`}>From</label>
              <input id={`to-s-${barber.id}`} type="date" name="start" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`to-e-${barber.id}`}>To (inclusive)</label>
              <input id={`to-e-${barber.id}`} type="date" name="end" required className={inputClass} />
            </div>
          </div>
          <input name="reason" placeholder="Reason (optional)" aria-label="Reason" className={inputClass} />
          <SubmitButton className={outlineButton}>Add time off</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function OpeningHoursForm({ hours }: { hours: Range[] }) {
  const [state, action] = useActionState(hoursAction, null);
  return (
    <form action={action} className="space-y-3 p-4">
      <Flash state={state} />
      <HoursEditor hours={hours} />
      <SubmitButton className={primaryButton}>Save opening hours</SubmitButton>
    </form>
  );
}

export function ClosedDates({ closed }: { closed: { id: string; date: string; reason: string | null }[] }) {
  const [state, action] = useActionState(closedDateAction, null);
  return (
    <div className="space-y-3 p-4">
      <p className="font-semibold">Closed dates</p>
      {closed.length === 0 && <p className="text-sm text-ink-muted">None. Add holidays so nobody can book them.</p>}
      <ul className="space-y-1">
        {closed.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-sm">
            <span>{c.date}{c.reason ? ` · ${c.reason}` : ""}</span>
            <ActionButton action={() => removeClosedDateAction(c.id)} className="font-semibold text-status-danger-ink underline">Remove</ActionButton>
          </li>
        ))}
      </ul>
      <form action={action} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <input type="date" name="date" required aria-label="Closed date" className={inputClass} />
        <input name="reason" placeholder="Reason" aria-label="Reason" className={inputClass} />
        <SubmitButton className="rounded-xl bg-brand-900 px-4 py-3 font-semibold text-white">Add</SubmitButton>
      </form>
      <Flash state={state} />
    </div>
  );
}

function Toggle({ name, title, sub, on }: { name: string; title: string; sub: string; on: boolean }) {
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-ink-muted">{sub}</span>
      </span>
      <input type="checkbox" role="switch" name={name} defaultChecked={on} className="size-6 accent-brand-900" />
    </label>
  );
}

export function RulesForm(r: { bookingEnabled: boolean; autoConfirm: boolean; cancelCutoffMinutes: number; loyaltyOn: boolean; loyaltyThreshold: number; slotGridMinutes: number }) {
  const [state, action] = useActionState(rulesAction, null);
  return (
    <form action={action}>
      <div className="divide-y divide-border">
        <Toggle name="bookingEnabled" title="Online booking" sub="Customers can book from your link" on={r.bookingEnabled} />
        <Toggle name="autoConfirm" title="Confirm online bookings automatically" sub="Untick to approve each one yourself" on={r.autoConfirm} />
        <div className="flex items-center gap-3 px-4 py-3">
          <label htmlFor="cutoff" className="flex-1">
            <span className="block font-semibold">Free cancellation until</span>
            <span className="block text-sm text-ink-muted">Customers can cancel or move it themselves</span>
          </label>
          <span className="flex items-center gap-1">
            <input id="cutoff" name="cancelCutoffHours" type="number" min={0} max={72} step="0.5" defaultValue={r.cancelCutoffMinutes / 60} className="w-16 rounded-lg border border-border px-2 py-1.5" />
            <span className="text-sm">h before</span>
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <label htmlFor="grid" className="flex-1 font-semibold">Booking slot length</label>
          <select id="grid" name="slotGridMinutes" defaultValue={r.slotGridMinutes} className="rounded-lg border border-border px-2 py-1.5">
            {[10, 15, 20, 30, 60].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </div>
        <Toggle name="loyaltyOn" title="Loyalty rewards" sub={`Free cut after every ${r.loyaltyThreshold} visits`} on={r.loyaltyOn} />
        <div className="flex items-center gap-3 px-4 py-3">
          <label htmlFor="threshold" className="flex-1 font-semibold">Visits for a free cut</label>
          <input id="threshold" name="loyaltyThreshold" type="number" min={2} max={50} defaultValue={r.loyaltyThreshold} className="w-16 rounded-lg border border-border px-2 py-1.5" />
        </div>
      </div>
      <div className="space-y-2 p-4">
        <Flash state={state} />
        <SubmitButton className={primaryButton}>Save booking rules</SubmitButton>
      </div>
    </form>
  );
}

export function OffersSection({ promotions, services, currency }: { promotions: { id: string; name: string; kind: string; value: number; startsOn: string; endsOn: string; isBirthday: boolean; services: string[] }[]; services: { id: string; name: string }[]; currency: string }) {
  const [state, action] = useActionState(promotionAction, null);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-ink-muted">Offers are the only way a discount appears in a message. Messages never contain hand-typed offers.</p>
      <ul className="space-y-2">
        {promotions.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 text-sm">
            <span>
              <span className="block font-semibold">{p.name}{p.isBirthday ? " · birthday" : ""}</span>
              <span className="block text-ink-muted">
                {p.kind === "PERCENT" ? `${p.value}% off` : p.kind === "FIXED" ? `${currency} ${p.value} off` : "Free service"} · {p.services.join(", ")} · {p.startsOn} → {p.endsOn}
              </span>
            </span>
            <ActionButton action={() => endPromotionAction(p.id)} className="shrink-0 font-semibold text-status-danger-ink underline" confirm="End this offer now?">End</ActionButton>
          </li>
        ))}
      </ul>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={outlineButton}>+ New offer</button>
      ) : (
        <form action={action} className="space-y-3">
          <Flash state={state} />
          <input name="name" placeholder="Name, e.g. Midweek deal" aria-label="Offer name" required className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <select name="kind" aria-label="Type" className={inputClass} defaultValue="PERCENT">
              <option value="PERCENT">% off</option>
              <option value="FIXED">Amount off</option>
              <option value="FREE_SERVICE">Free service</option>
            </select>
            <input name="value" type="number" min={0} step="any" placeholder="10" aria-label="Value" className={inputClass} />
          </div>
          <fieldset>
            <legend className={labelClass}>Services</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
                  <input type="checkbox" name="serviceIds" value={s.id} className="accent-brand-900" />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="ps">Starts</label>
              <input id="ps" name="startsOn" type="date" defaultValue={today} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="pe">Ends</label>
              <input id="pe" name="endsOn" type="date" required className={inputClass} />
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="isBirthday" className="size-5 accent-brand-900" />
            Use for birthday messages
          </label>
          <SubmitButton className={primaryButton}>Save offer</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function StaffSection({
  members,
  invitations,
  unlinkedBarbers,
}: {
  members: { id: string; name: string; email: string; role: string; active: boolean; self: boolean }[];
  invitations: { id: string; email: string; role: string; expires: string }[];
  unlinkedBarbers: { id: string; displayName: string }[];
}) {
  const [state, action] = useActionState(inviteAction, null);
  return (
    <div className="space-y-4 p-4">
      <ul className="space-y-2">
        {members.map((m) => (
          <MemberRow key={m.id} m={m} />
        ))}
        {invitations.map((i) => (
          <li key={i.id} className="flex items-center justify-between rounded-xl border border-dashed border-border px-3 py-2 text-sm">
            <span>
              <span className="block font-semibold">{i.email}</span>
              <span className="block text-ink-muted">Invited as {i.role} · expires {i.expires}</span>
            </span>
            <ActionButton action={() => revokeInviteAction(i.id)} className="font-semibold text-status-danger-ink underline">Cancel</ActionButton>
          </li>
        ))}
      </ul>
      <form action={action} className="space-y-2">
        <p className="font-semibold">Invite staff</p>
        <Flash state={state} />
        <input name="email" type="email" placeholder="Email" aria-label="Email" required className={inputClass} />
        <div className="grid grid-cols-2 gap-2">
          <select name="role" aria-label="Role" defaultValue="receptionist" className={inputClass}>
            <option value="receptionist">Receptionist</option>
            <option value="barber">Barber</option>
            <option value="owner">Owner</option>
          </select>
          <select name="barberId" aria-label="Link to barber profile" defaultValue="" className={inputClass}>
            <option value="">New barber profile</option>
            {unlinkedBarbers.map((b) => (
              <option key={b.id} value={b.id}>Link to {b.displayName}</option>
            ))}
          </select>
        </div>
        <SubmitButton className={primaryButton}>Send invitation</SubmitButton>
      </form>
    </div>
  );
}

function MemberRow({ m }: { m: { id: string; name: string; email: string; role: string; active: boolean; self: boolean } }) {
  const [state, action] = useActionState(memberAccessAction.bind(null, m.id), null);
  return (
    <li className="rounded-xl bg-surface px-3 py-2 text-sm">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${m.active ? "" : "line-through"}`}>{m.name}{m.self ? " (you)" : ""}</span>
          <span className="block truncate text-ink-muted">{m.email}</span>
        </span>
        {m.self ? (
          <span className="font-semibold capitalize">{m.role}</span>
        ) : (
          <>
            <select name="role" defaultValue={m.role} aria-label={`${m.name}'s role`} className="rounded-lg border border-border px-2 py-1">
              <option value="owner">Owner</option>
              <option value="receptionist">Receptionist</option>
              <option value="barber">Barber</option>
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="active" defaultChecked={m.active} className="accent-brand-900" />
              Access
            </label>
            <SubmitButton className="rounded-lg bg-brand-900 px-3 py-1 font-semibold text-white">Save</SubmitButton>
          </>
        )}
      </form>
      {state?.error && <p className="mt-1 text-status-danger-ink">{state.error}</p>}
    </li>
  );
}

type PaymentAccount = { connected: boolean; ready: boolean; label: string | null };

export function PaymentsForm({
  provider,
  testMode,
  account,
  banks,
  paystackAllowed,
  returned,
}: {
  provider: string | null;
  testMode: boolean;
  account: PaymentAccount;
  banks: { code: string; name: string }[] | null;
  paystackAllowed: boolean;
  returned: string | null;
}) {
  const [state, action] = useActionState(paymentProviderAction, null);
  return (
    <div className="divide-y divide-border">
      <form action={action} className="space-y-3 p-4">
        <Flash state={state} />
        <label className={labelClass} htmlFor="provider">Online payments</label>
        <select id="provider" name="provider" defaultValue={provider ?? ""} className={inputClass}>
          <option value="">Off (customers pay at the salon)</option>
          {paystackAllowed && <option value="PAYSTACK">Paystack</option>}
          <option value="STRIPE">Stripe</option>
        </select>
        <p className="text-xs text-ink-muted">
          {testMode
            ? "Test mode: accounts and payments are simulated and no money moves."
            : "Money goes straight to your own account; we never hold it. A booking is marked paid only when the provider confirms it."}
        </p>
        <SubmitButton className={primaryButton}>Save</SubmitButton>
      </form>
      {provider && <PaymentAccountPanel provider={provider} account={account} banks={banks} returned={returned} />}
    </div>
  );
}

function PaymentAccountPanel({ provider, account, banks, returned }: { provider: string; account: PaymentAccount; banks: { code: string; name: string }[] | null; returned: string | null }) {
  const [paystack, paystackAction] = useActionState(connectPaystackAction, null);
  const [stripe, stripeAction] = useActionState(startStripeConnectAction, null);
  const name = provider === "PAYSTACK" ? "Paystack" : "Stripe";
  // A full page load, as Stripe expects: its pages, then back to /app/settings/stripe.
  useEffect(() => {
    if (stripe?.link) window.location.assign(stripe.link);
  }, [stripe]);

  if (account.ready) {
    return (
      <div className="space-y-3 p-4" role="group" aria-label="Payout account">
        <p className="text-sm">
          <span className="font-semibold">Payouts go to:</span> {account.label ?? `your ${name} account`}
        </p>
        <ActionButton
          action={disconnectPaymentAccountAction}
          confirm="Disconnect this account? Customers won't be able to pay online until you connect again."
          className={outlineButton}
        >
          Disconnect account
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4" role="group" aria-label="Payout account">
      <p className="rounded-xl bg-status-in-chair px-4 py-3 text-sm text-[#5a3d00]">Customers can&apos;t pay online until you connect the account your takings go to.</p>
      {provider === "PAYSTACK" ? (
        <form action={paystackAction} className="space-y-3">
          <Flash state={paystack} />
          {banks === null ? (
            <p role="alert" className="text-sm text-status-danger-ink">We couldn&apos;t load the bank list from Paystack. Refresh the page to try again.</p>
          ) : (
            <>
              <label className={labelClass} htmlFor="bank">Bank</label>
              <select id="bank" name="bank" required defaultValue="" className={inputClass}>
                <option value="" disabled>Choose your bank</option>
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
              <label className={labelClass} htmlFor="accountNumber">Account number</label>
              <input id="accountNumber" name="accountNumber" inputMode="numeric" autoComplete="off" required className={inputClass} />
              <SubmitButton className={primaryButton} pendingText="Connecting…">Connect account</SubmitButton>
            </>
          )}
        </form>
      ) : (
        <form action={stripeAction} className="space-y-3">
          <Flash state={stripe} />
          {returned === "pending" && <p role="status" className="text-sm">Stripe still needs a few details before you can take payments.</p>}
          {returned === "error" && <p role="alert" className="text-sm text-status-danger-ink">Stripe didn&apos;t respond. Please try again.</p>}
          <p className="text-sm text-ink-muted">You&apos;ll set up your own Stripe account on Stripe&apos;s site, then come back here.</p>
          <SubmitButton className={primaryButton} pendingText="Opening Stripe…">{account.connected ? "Continue Stripe setup" : "Set up Stripe"}</SubmitButton>
        </form>
      )}
    </div>
  );
}
