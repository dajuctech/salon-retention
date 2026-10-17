// Home dashboard — design p4, US-25. Barbers get "My day" (UI_UX_DESIGN_PLAN §3.6).
import { Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar, BOOKING_BADGE, Badge, Card, EmptyState, MESSAGE_BADGE, PageHeader, SectionTitle, Skeleton, StatCard } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { localParts } from "@/domain/time";
import { requireStaff } from "@/server/auth/session";
import { bookingPageUrl } from "@/server/messaging/queue";
import { dashboardData } from "@/server/staff/queries/dashboard";
import { CopyLink } from "./ui-client";

export const instant = false;

export default function HomePage({ searchParams }: PageProps<"/app">) {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/app">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const { welcome } = await searchParams;
  const d = await dashboardData(s);
  const tz = s.salon.timezone;
  const now = new Date();
  const hour = localParts(now, tz).hour;
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);
  const money = (m: number) => formatMoney(m, s.salon.currency);
  const isBarber = s.member.role === "barber";

  return (
    <>
      <PageHeader title={`${greeting}, ${s.user.name.split(" ")[0]}`} subtitle={dateLine} userName={s.user.name} />
      <div className="space-y-3 px-5 pt-5 lg:mx-auto lg:max-w-6xl">
        {welcome && (
          <Card className="p-4">
            <p className="font-bold">Welcome! Three things to finish setting up</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>
                <Link href="/app/settings#services" className="underline">Check your services and prices</Link>
              </li>
              <li>
                <Link href="/app/settings#barbers" className="underline">Add your barbers and their hours</Link>
              </li>
              <li>Share your booking link with customers:</li>
            </ol>
            <CopyLink link={bookingPageUrl(s.salon.slug)} />
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link href="/app/walk-in" className="flex items-center justify-center gap-2 rounded-2xl bg-accent-500 py-3 font-semibold text-brand-900">
            <UserPlus className="size-5" aria-hidden /> Walk-in
          </Link>
          <Link href="/app/bookings/new" className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 font-semibold text-brand-900">
            <Plus className="size-5" aria-hidden /> Booking
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {d.seeMoney && <StatCard label="Revenue today" value={money(d.revenueTodayMinor)} sub={`${money(d.toCollectMinor)} still to collect`} href="/app/payments" />}
          <StatCard label={isBarber ? "My bookings today" : "Bookings today"} value={d.bookingsToday} sub={`${d.doneToday} done · ${d.bookingsToday - d.doneToday} to go`} href="/app/calendar" />
          <StatCard
            label="No-shows this week"
            value={d.noShowsThisWeek}
            tone={d.noShowsThisWeek ? "danger" : "plain"}
            sub={d.noShowsThisWeek ? `${d.noShowsRebooked} rebooked` : "None so far"}
          />
          {!isBarber && (
            <StatCard label="Due for a reminder" value={d.due.total} tone="dark" sub="Past their usual gap" href="/app/customers?filter=due" />
          )}
        </div>

        <SectionTitle action={<Link href="/app/calendar" className="text-sm font-semibold text-brand-900 underline">Open calendar</Link>}>
          Today&apos;s bookings
        </SectionTitle>
        {d.today.length === 0 ? (
          <EmptyState action={<Link href="/app/walk-in" className="font-semibold text-brand-900 underline">Record a walk-in</Link>}>No bookings today yet.</EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {d.today.map((b) => (
              <Link key={b.id} href={`/app/bookings/${b.id}`} className="flex items-center gap-4 px-4 py-3">
                <span className="w-12 font-bold">{b.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{b.customer}</span>
                  <span className="block truncate text-sm text-ink-muted">
                    {b.service} · {b.barber}
                  </span>
                </span>
                <Badge tone={BOOKING_BADGE[b.status].tone}>{BOOKING_BADGE[b.status].label}</Badge>
              </Link>
            ))}
          </Card>
        )}

        {d.tomorrow.length > 0 && (
          <>
            <div className="mt-6 flex items-center justify-between">
              <h2 className="text-xl font-bold">Upcoming</h2>
              <span className="text-sm text-ink-muted">Tomorrow · {d.tomorrow.length} booked</span>
            </div>
            <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2">
              {d.tomorrow.map((b) => (
                <Link key={b.id} href={`/app/bookings/${b.id}`} className="w-44 shrink-0 rounded-2xl border border-border bg-card p-3">
                  <p className="font-bold">{b.time}</p>
                  <p className="truncate font-semibold">{b.customer}</p>
                  <p className="truncate text-sm text-ink-muted">
                    {b.service} · {b.barber}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}

        {!isBarber && (
          <>
            <Card className="mt-6 p-4">
              <h2 className="text-xl font-bold">Customers due for a reminder</h2>
              {d.due.total === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">Nobody is past their usual gap right now.</p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-ink-muted">
                    {d.due.total} customer{d.due.total === 1 ? " hasn't" : "s haven't"} been back since their usual cut was due.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {d.due.list.map((c) => (
                      <li key={c.id}>
                        <Link href={`/app/customers/${c.id}`} className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <span className="flex-1 font-semibold">{c.name}</span>
                          <span className="text-sm text-ink-muted">Last visit {c.lastVisit}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Link href="/app/whatsapp/approve" className="mt-4 flex w-full items-center justify-center rounded-2xl bg-brand-900 py-3 font-semibold text-white">
                Review follow-up messages{d.drafts ? ` (${d.drafts})` : ""}
              </Link>
            </Card>

            {d.birthdays.length > 0 && (
              <section className="rounded-2xl bg-accent-50 p-4">
                <h2 className="text-xl font-bold text-[#5a4210]">Birthdays this week</h2>
                <ul className="mt-3 space-y-3">
                  {d.birthdays.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3">
                      <Link href={`/app/customers/${b.id}`}>
                        <span className="block font-semibold">{b.name}</span>
                        <span className="block text-sm text-ink-muted">{b.when}</span>
                      </Link>
                      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${b.status.startsWith("No") || b.status === "Failed" ? "bg-card text-status-danger-ink" : "bg-card text-brand-900"}`}>
                        {b.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <SectionTitle action={<Link href="/app/whatsapp?tab=sent" className="text-sm font-semibold text-brand-900 underline">See all</Link>}>
              Recent WhatsApp messages
            </SectionTitle>
            {d.recentMessages.length === 0 ? (
              <EmptyState>No messages sent yet.</EmptyState>
            ) : (
              <Card className="divide-y divide-border">
                {d.recentMessages.map((m) => (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex justify-between gap-3">
                      <p className="truncate font-semibold">{m.title}</p>
                      <p className={`shrink-0 text-sm font-semibold ${m.status === "FAILED" ? "text-status-danger-ink" : "text-brand-900"}`}>
                        {MESSAGE_BADGE[m.status].label} · {m.time}
                      </p>
                    </div>
                    <p className="truncate text-sm text-ink-muted">{m.text}</p>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
