// Booking detail — UI_UX_DESIGN_PLAN §3.3/§3.4: status actions, payments, free cut, reschedule.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BOOKING_BADGE, Badge, Card, MESSAGE_BADGE, PAYMENT_BADGE, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { requireStaff } from "@/server/auth/session";
import { methodLabel } from "@/server/staff/queries/payments";
import { bookingDetail } from "@/server/staff/queries/bookings";
import { BookingStatusActions, PaymentLinkPanel, PaymentPanel, ReschedulePanel } from "./booking-client";
import { requireRecord } from "@/server/auth/guards";

export const instant = false;

export default async function BookingPage({ params, searchParams }: PageProps<"/app/bookings/[id]">) {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requireRecord("booking", (await params).id);
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <Booking params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Booking({ params, searchParams }: { params: PageProps<"/app/bookings/[id]">["params"]; searchParams: PageProps<"/app/bookings/[id]">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const { id } = await params;
  const { created } = await searchParams;
  const b = await bookingDetail(s, id);
  if (!b) notFound();
  const money = (m: number) => formatMoney(m, b.currency);
  const badge = BOOKING_BADGE[b.status];

  return (
    <>
      <PageHeader title={b.customerName} subtitle={`${b.date} · ${b.time}`} back={{ href: "/app/calendar", label: "Calendar" }} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        {created && <p role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">Booked. The customer gets a WhatsApp confirmation if they agreed to messages.</p>}
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold">{b.serviceName}</p>
              <p className="text-ink-muted">
                {b.durationMin} min · {b.barberName} · {b.source === "WALK_IN" ? "Walk-in" : b.source === "ONLINE" ? "Booked online" : "Booked by staff"}
              </p>
            </div>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-muted">Booking ref</dt>
            <dd className="font-semibold">{b.ref}</dd>
            <dt className="text-ink-muted">Price</dt>
            <dd className="font-semibold">{money(b.priceMinor)}</dd>
            <dt className="text-ink-muted">Payment</dt>
            <dd>
              <Badge tone={PAYMENT_BADGE[b.payment.status].tone}>{PAYMENT_BADGE[b.payment.status].label}</Badge>
              {b.payment.status === "PART_PAID" && <span className="ml-2 text-ink-muted">{money(b.payment.balanceMinor)} to pay</span>}
            </dd>
            {b.loyalty && (
              <>
                <dt className="text-ink-muted">Loyalty</dt>
                <dd>
                  {b.loyalty.stamps} of {b.loyalty.threshold} cuts
                </dd>
              </>
            )}
          </dl>
          {b.notes && <p className="mt-3 rounded-xl bg-surface p-3 text-sm">{b.notes}</p>}
          <Link href={`/app/customers/${b.customerId}`} className="mt-4 inline-block text-sm font-semibold text-brand-900 underline">
            Open customer profile
          </Link>
        </Card>

        {b.nextStatuses.length > 0 && <BookingStatusActions bookingId={b.id} next={b.nextStatuses} />}

        {(b.canPay || b.canRefund) && (
          <PaymentPanel
            bookingId={b.id}
            currency={b.currency}
            balanceMinor={b.payment.balanceMinor}
            paidMinor={b.payment.paidMinor}
            canPay={b.canPay && b.payment.balanceMinor > 0}
            canRefund={b.canRefund}
            freeCutAvailable={b.freeCutAvailable}
          />
        )}
        {b.canPay && b.onlinePayments && b.payment.balanceMinor > 0 && <PaymentLinkPanel bookingId={b.id} />}

        {b.payments.length > 0 && (
          <>
            <SectionTitle>Payments</SectionTitle>
            <Card className="divide-y divide-border">
              {b.payments.map((p) => (
                <div key={p.id} className="flex justify-between px-4 py-3 text-sm">
                  <span>
                    {p.kind === "REFUND" ? "Refund" : p.method === "LOYALTY" ? "Free cut (loyalty)" : methodLabel(p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                    <span className="block text-ink-muted">{p.when}</span>
                  </span>
                  <span className={`font-semibold ${p.kind === "REFUND" ? "text-status-danger-ink" : ""}`}>
                    {p.kind === "REFUND" ? "−" : ""}
                    {money(p.amountMinor)}
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}

        {b.canReschedule && (
          <ReschedulePanel bookingId={b.id} serviceId={b.serviceId} barberId={b.barberId} barbers={b.barbers} days={b.days} timeZone={s.salon.timezone} currentStart={b.startsAt} />
        )}

        {b.messages.length > 0 && (
          <>
            <SectionTitle>WhatsApp messages for this booking</SectionTitle>
            <Card className="divide-y divide-border">
              {b.messages.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    <span className="font-semibold">{m.type}</span>
                    <span className="block text-ink-muted">
                      {m.when}
                      {m.reason ? ` · ${m.reason.replace(/_/g, " ")}` : ""}
                    </span>
                  </span>
                  <Badge tone={MESSAGE_BADGE[m.status].tone}>{MESSAGE_BADGE[m.status].label}</Badge>
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
