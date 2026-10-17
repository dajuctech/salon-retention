// Reports — design p11, docs/metrics.md. Owner only.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { formatMoney, minorUnitDigits } from "@/domain/money";
import { can } from "@/domain/permissions";
import { requirePage } from "@/server/auth/guards";
import { requireStaff } from "@/server/auth/session";
import { PERIODS, reportsData } from "@/server/staff/queries/reports";

export const instant = false;

export default async function ReportsPage({ searchParams }: PageProps<"/app/reports">) {
  // Checked before streaming so a forbidden visit gets a real 404 status.
  await requirePage("reports.view");
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

const pct = (v: number | null, digits = 0) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);
const change = (v: number | null) => (v === null ? "No earlier data to compare" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}% vs previous ${"period"}`);

async function Reports({ searchParams }: { searchParams: PageProps<"/app/reports">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  if (!can(s.member.role, "reports.view")) notFound();
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days) as (typeof PERIODS)[number]) ? Number(sp.days) : 30;
  const r = await reportsData(s, days);
  const cur = s.salon.currency;
  const money = (m: number) => formatMoney(m, cur);
  const compact = (m: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: cur, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1, currencyDisplay: "narrowSymbol" }).format(m / 10 ** minorUnitDigits(cur));
  const maxWeek = Math.max(1, ...r.weeks.map((w) => w.revenueMinor));
  const maxService = Math.max(1, ...r.services.map((x) => x.count));

  return (
    <>
      <PageHeader title="Reports" subtitle={`Last ${days} days`} userName={s.user.name} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        <nav aria-label="Period" className="grid grid-cols-3 gap-1 rounded-2xl bg-status-done p-1">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/app/reports?days=${p}`}
              aria-current={p === days ? "page" : undefined}
              className={`rounded-xl py-2.5 text-center font-semibold ${p === days ? "bg-card shadow-sm" : "text-ink-muted"}`}
            >
              {p} days
            </Link>
          ))}
        </nav>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="p-4">
            <p className="text-sm text-ink-muted">Revenue</p>
            <p className="mt-1 text-3xl font-bold text-brand-900">{compact(r.revenueMinor)}</p>
            <p className="mt-1 text-sm font-semibold">{change(r.revenueChange)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-ink-muted">Bookings</p>
            <p className="mt-1 text-3xl font-bold text-brand-900">{r.bookings}</p>
            <p className="mt-1 text-sm font-semibold">{change(r.bookingsChange)}</p>
          </Card>
          <div className="rounded-2xl bg-brand-900 p-4 text-white">
            <p className="text-sm text-white/85">Customers who returned</p>
            <p className="mt-1 text-3xl font-bold text-accent-500">{r.returnRate ? pct(r.returnRate.rate) : "—"}</p>
            <p className="mt-1 text-sm text-white/85">
              {r.returnRate ? `within 6 weeks (${r.returnRate.returned} of ${r.returnRate.cohort} visits)` : "Needs 6+ weeks of visits"}
            </p>
          </div>
          <Card className="p-4">
            <p className="text-sm text-ink-muted">No-show rate</p>
            <p className="mt-1 text-3xl font-bold text-status-danger-ink">{pct(r.noShowRate, 1)}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {r.noShows} of {r.noShowBase} bookings
            </p>
          </Card>
        </div>

        <Card className="p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Revenue by week</h2>
            <span className="text-sm text-ink-muted">{cur}</span>
          </div>
          <figure className="mt-4">
            <div className="flex h-40 items-end justify-around gap-[2px] border-b border-border" aria-hidden>
              {r.weeks.map((w, i) => {
                const h = (w.revenueMinor / maxWeek) * 100;
                return (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${w.label}: ${money(w.revenueMinor)}`}>
                    <span className="mb-1 text-xs font-semibold text-ink">{compact(w.revenueMinor)}</span>
                    <span
                      className={`w-6 rounded-t ${w.partial ? "bg-chart-highlight" : "bg-chart-1"}`}
                      style={{ height: `${Math.max(h, w.revenueMinor ? 2 : 0)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex justify-around text-xs text-ink-muted" aria-hidden>
              {r.weeks.map((w, i) => (
                <span key={i} className={`flex-1 text-center ${w.partial ? "font-semibold text-ink" : ""}`}>
                  {w.label}
                </span>
              ))}
            </div>
            <table className="sr-only">
              <caption>Revenue by week</caption>
              <tbody>
                {r.weeks.map((w, i) => (
                  <tr key={i}>
                    <th scope="row">{w.label}</th>
                    <td>{money(w.revenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        </Card>

        <section className="rounded-2xl bg-accent-50 p-4">
          <h2 className="text-lg font-bold text-[#5a4210]">Booked within 7 days of a message</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[#3d2d0a]">
            <div>
              <p className="text-2xl font-bold">{r.messagesSent}</p>
              <p className="text-sm">offers &amp; win-backs sent</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{r.brought.bookings}</p>
              <p className="text-sm">bookings within 7 days</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{compact(r.brought.revenueMinor)}</p>
              <p className="text-sm">value of those bookings</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-[#5a4210]">Some of these customers would have booked anyway. The holdout comparison shows the real effect once there&apos;s enough data.</p>
        </section>

        <Card className="p-4">
          <h2 className="text-lg font-bold">Popular services</h2>
          {r.services.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No bookings in this period.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {r.services.map((x) => (
                <li key={x.name}>
                  <div className="flex justify-between font-semibold">
                    <span>{x.name}</span>
                    <span>{x.count}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-status-done" aria-hidden>
                    <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(x.count / maxService) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <section>
          <h2 className="mb-2 text-xl font-bold">By barber</h2>
          <Card className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface text-sm text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Barber</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Bookings</th>
                  <th scope="col" className="px-2 py-2 font-semibold">No-shows</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.barbers.map((b) => (
                  <tr key={b.name}>
                    <th scope="row" className="px-4 py-3 font-bold">{b.name}</th>
                    <td className="px-2 py-3">{b.bookings}</td>
                    <td className="px-2 py-3">{pct(b.noShowRate, 1)}</td>
                    <td className="px-4 py-3">{compact(b.revenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <a href={`/app/reports/export?days=${days}`} className="flex w-full items-center justify-center rounded-2xl border border-brand-900 bg-card py-3.5 font-semibold text-brand-900">
          Export report as CSV
        </a>
      </div>
    </>
  );
}
