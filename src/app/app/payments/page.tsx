// Payments — design p8, US-16.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, EmptyState, PAYMENT_BADGE, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { requireStaff } from "@/server/auth/session";
import { paymentsData, type PaymentFilter } from "@/server/staff/queries/payments";
import { QuickPay } from "./quick-pay";

export const instant = false;

const FILTERS: { key: PaymentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "unpaid", label: "Unpaid" },
  { key: "part", label: "Part-paid" },
];

export default function PaymentsPage({ searchParams }: PageProps<"/app/payments">) {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Payments searchParams={searchParams} />
    </Suspense>
  );
}

async function Payments({ searchParams }: { searchParams: PageProps<"/app/payments">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const sp = await searchParams;
  const filter = (FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all") as PaymentFilter;
  const d = await paymentsData(s, filter);
  const money = (m: number) => formatMoney(m, s.salon.currency);
  const methodTotal = d.byMethod.CASH + d.byMethod.TRANSFER + d.byMethod.POS + d.byMethod.CARD + d.byMethod.ONLINE;
  const methods = [
    { key: "CASH", label: "Cash", color: "bg-brand-900" },
    { key: "TRANSFER", label: "Transfer", color: "bg-accent-500" },
    { key: "POS", label: "POS", color: "bg-[#9fb9ab]" },
    { key: "CARD", label: "Card", color: "bg-[#5b7f6e]" },
  ].filter((m) => d.byMethod[m.key] > 0 || m.key !== "CARD");
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: s.salon.timezone }).format(new Date());
  const counts: Record<PaymentFilter, number | null> = { all: null, paid: d.counts.paid, unpaid: d.counts.unpaid, part: d.counts.part };

  return (
    <>
      <PageHeader title="Payments" subtitle={today} userName={s.user.name} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-brand-900 p-4 text-white">
            <p className="text-sm text-white/85">Collected today</p>
            <p className="mt-1 text-3xl font-bold text-accent-500">{money(d.collectedToday)}</p>
            <p className="mt-1 text-sm text-white/85">of {money(d.bookedToday)} booked</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm text-ink-muted">Outstanding</p>
            <p className="mt-1 text-3xl font-bold text-status-danger-ink">{money(d.outstanding)}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {d.owingCustomers} customer{d.owingCustomers === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <Card className="p-4">
          <h2 className="text-lg font-bold">By payment method</h2>
          {methodTotal === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No payments recorded today yet.</p>
          ) : (
            <>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-status-done" role="img" aria-label={methods.map((m) => `${m.label} ${money(d.byMethod[m.key])}`).join(", ")}>
                {methods.map((m) => (
                  <span key={m.key} className={m.color} style={{ width: `${(d.byMethod[m.key] / methodTotal) * 100}%` }} />
                ))}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {methods.map((m) => (
                  <div key={m.key}>
                    <dt className="flex items-center gap-1.5 text-sm">
                      <span className={`inline-block size-2.5 rounded-sm ${m.color}`} aria-hidden />
                      {m.label}
                    </dt>
                    <dd className="font-bold">{money(d.byMethod[m.key])}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </Card>

        <nav aria-label="Filter payments" className="flex gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/app/payments?filter=${f.key}`}
              aria-current={filter === f.key ? "true" : undefined}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${filter === f.key ? "bg-brand-900 text-white" : "border border-border bg-card"}`}
            >
              {f.label}
              {counts[f.key] !== null ? ` ${counts[f.key]}` : ""}
            </Link>
          ))}
        </nav>

        {filter !== "paid" && (
          <>
            <SectionTitle>Needs collecting</SectionTitle>
            {d.owing.length === 0 ? (
              <EmptyState>Nothing outstanding. 🎉</EmptyState>
            ) : (
              <Card className="divide-y divide-border">
                {d.owing.map((o) => (
                  <div key={o.bookingId} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/app/bookings/${o.bookingId}`}>
                        <span className="block font-semibold">{o.customer}</span>
                        <span className="block text-sm text-ink-muted">
                          {o.detail}
                          {o.paidMinor > 0 ? ` · ${money(o.paidMinor)} paid` : ""}
                        </span>
                      </Link>
                      <span className="text-right">
                        <span className="block font-bold">{money(o.balanceMinor)}</span>
                        <Badge tone={PAYMENT_BADGE[o.status].tone}>{PAYMENT_BADGE[o.status].label}</Badge>
                      </span>
                    </div>
                    <QuickPay bookingId={o.bookingId} amount={o.balanceMinor} currency={s.salon.currency} part={o.paidMinor > 0} freeCut={o.freeCutAvailable} />
                  </div>
                ))}
              </Card>
            )}
          </>
        )}

        {filter !== "unpaid" && filter !== "part" && (
          <>
            <SectionTitle>Paid today</SectionTitle>
            {d.paidToday.length === 0 ? (
              <EmptyState>No payments yet today.</EmptyState>
            ) : (
              <Card className="divide-y divide-border">
                {d.paidToday.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="block font-semibold">{p.customer}</span>
                      <span className="block text-sm text-ink-muted">{p.detail}</span>
                    </span>
                    <span className="text-right">
                      <span className={`block font-bold ${p.refund ? "text-status-danger-ink" : ""}`}>{money(p.amountMinor)}</span>
                      <Badge tone={p.refund ? "red" : "green"}>{p.refund ? "Refund" : "Paid"}</Badge>
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
        <Link href="/app/walk-in" className="flex w-full items-center justify-center rounded-2xl bg-accent-500 py-3.5 font-semibold text-brand-900">
          + Record a walk-in and payment
        </Link>
      </div>
    </>
  );
}
