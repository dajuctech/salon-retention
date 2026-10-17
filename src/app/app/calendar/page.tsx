// Calendar — design p5. US-14 day and week views per barber; US-15 month view. Tap a booking to
// manage it; drag one in the day view to move it.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, PAYMENT_BADGE, PageHeader, Skeleton } from "@/components/ui";
import { WEEKDAY_SHORT } from "@/domain/format";
import { requireStaff } from "@/server/auth/session";
import { calendarDay, calendarMonth, calendarWeek } from "@/server/staff/queries/calendar";
import { CalendarGrid, STATUS_STYLE, STATUS_TEXT } from "./calendar-grid";

export const instant = false;

type View = "day" | "week" | "month";
const VIEWS: { key: View; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export default function CalendarPage({ searchParams }: PageProps<"/app/calendar">) {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

const longDate = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

async function Calendar({ searchParams }: { searchParams: PageProps<"/app/calendar">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const sp = await searchParams;
  const date = typeof sp.date === "string" ? sp.date : undefined;
  const barber = typeof sp.barber === "string" ? sp.barber : "all";
  const view: View = sp.view === "week" || sp.view === "month" ? sp.view : "day";
  const href = (patch: Record<string, string>) => `/app/calendar?${new URLSearchParams({ view, barber, ...(date ? { date } : {}), ...patch })}`;

  const body =
    view === "week" ? await weekView(s, date, barber, href) : view === "month" ? await monthView(s, date, barber, href) : await dayView(s, date, barber, href);

  return (
    <>
      <PageHeader title="Calendar" subtitle={body.subtitle} userName={s.user.name} />
      <div className="px-5 pt-4">
        <nav aria-label="Calendar view" className="mb-3 inline-flex rounded-full border border-border bg-card p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key })}
              aria-current={view === v.key ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${view === v.key ? "bg-brand-900 text-white" : "text-ink-muted"}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        {body.nav}
        <div className="mt-3 flex items-center gap-2">
          <div className="-ml-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pl-1">
            {s.member.role !== "barber" &&
              [{ id: "all", name: "All" }, ...body.barbers].map((b) => (
                <Link
                  key={b.id}
                  href={href({ barber: b.id })}
                  aria-current={barber === b.id ? "true" : undefined}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${barber === b.id ? "border-brand-900 bg-brand-50" : "border-border bg-card"}`}
                >
                  {b.name}
                </Link>
              ))}
          </div>
          <Link href="/app/walk-in" className="shrink-0 rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold text-brand-900">
            Walk-in
          </Link>
          <Link href={`/app/bookings/new${date ? `?date=${date}` : ""}`} className="shrink-0 rounded-full bg-accent-500 px-4 py-2 text-sm font-bold text-brand-900">
            + New
          </Link>
        </div>
        {view !== "month" && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
            {["CONFIRMED", "IN_PROGRESS", "COMPLETED", "NO_SHOW"].map((st) => (
              <li key={st} className="flex items-center gap-1.5">
                <span className={`inline-block size-3 rounded ${STATUS_STYLE[st]}`} aria-hidden />
                {STATUS_TEXT[st]}
              </li>
            ))}
          </ul>
        )}
        {body.content}
      </div>
    </>
  );
}

type Href = (patch: Record<string, string>) => string;
type Staff = Awaited<ReturnType<typeof requireStaff>>;

async function dayView(s: Staff, date: string | undefined, barber: string, href: Href) {
  const c = await calendarDay(s, date, barber);
  return {
    subtitle: `${longDate(c.dateKey, { weekday: "long", day: "numeric", month: "long" })} · ${c.count} booking${c.count === 1 ? "" : "s"}`,
    barbers: c.barbers,
    nav: (
      <nav aria-label="Days" className="flex gap-1.5">
        {c.days.map((d) => {
          const active = d.key === c.dateKey;
          return (
            <Link
              key={d.key}
              href={href({ date: d.key })}
              aria-current={active ? "date" : undefined}
              className={`flex-1 rounded-xl border py-1.5 text-center ${active ? "border-brand-900 bg-brand-900 text-white" : "border-border bg-card"} ${d.closed && !active ? "opacity-50" : ""}`}
            >
              <span className="block text-xs">{WEEKDAY_SHORT[d.weekday]}</span>
              <span className="block text-lg font-bold">{d.day}</span>
            </Link>
          );
        })}
      </nav>
    ),
    content:
      c.columns.length === 0 ? (
        <NoBarbers />
      ) : (
        // key: a new day or filter starts with fresh positions.
        <CalendarGrid key={`${c.dateKey}|${barber}`} columns={c.columns} from={c.from} to={c.to} nowMin={c.nowMin} dateKey={c.dateKey} gridMin={c.gridMin} timeZone={c.timeZone} />
      ),
  };
}

async function weekView(s: Staff, date: string | undefined, barber: string, href: Href) {
  const w = await calendarWeek(s, date, barber);
  const range = `${longDate(w.monday, { day: "numeric", month: "short" })} to ${longDate(w.sunday, { day: "numeric", month: "short" })}`;
  return {
    subtitle: `Week of ${range} · ${w.count} booking${w.count === 1 ? "" : "s"}`,
    barbers: w.barbers,
    nav: <PrevNext label="week" prev={href({ date: w.prev })} next={href({ date: w.next })} title={range} />,
    content:
      w.barbers.length === 0 ? (
        <NoBarbers />
      ) : (
        <div className="mt-4 overflow-x-auto pb-4">
          <ol className="grid min-w-[56rem] grid-cols-7 gap-2" aria-label="Week">
            {w.days.map((d) => (
              <li key={d.key} className={`min-h-40 rounded-2xl border p-2 ${d.today ? "border-brand-900" : "border-border"} ${d.closed ? "bg-surface" : "bg-card"}`}>
                <Link href={href({ view: "day", date: d.key })} className="mb-2 block text-sm font-bold">
                  {WEEKDAY_SHORT[d.weekday]} {d.day}
                  {d.today && <span className="ml-1 text-xs font-semibold text-brand-700">Today</span>}
                </Link>
                {d.closed && d.bookings.length === 0 && <p className="text-xs text-ink-muted">Closed</p>}
                {!d.closed && d.bookings.length === 0 && <p className="text-xs text-ink-muted">No bookings</p>}
                <ul className="space-y-1.5">
                  {d.bookings.map((b) => (
                    <li key={b.id}>
                      <Link href={`/app/bookings/${b.id}`} className={`block rounded-lg px-2 py-1 text-xs leading-tight ${STATUS_STYLE[b.status]}`}>
                        <span className="block font-bold">
                          {b.time} {b.customer}
                        </span>
                        <span className="block truncate">
                          {b.service}
                          {barber === "all" && s.member.role !== "barber" ? ` · ${b.barber}` : ""}
                        </span>
                        <span className="block">
                          {STATUS_TEXT[b.status]} · {PAYMENT_BADGE[b.paymentStatus]?.label}
                          {b.walkIn ? " · walk-in" : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      ),
  };
}

async function monthView(s: Staff, date: string | undefined, barber: string, href: Href) {
  const m = await calendarMonth(s, date, barber);
  return {
    subtitle: `${m.title} · ${m.count} booking${m.count === 1 ? "" : "s"}`,
    barbers: m.barbers,
    nav: <PrevNext label="month" prev={href({ date: m.prev })} next={href({ date: m.next })} title={m.title} />,
    content: (
      <table className="mt-4 w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">{m.title}: bookings per day</caption>
        <thead>
          <tr className="text-xs font-semibold text-ink-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: m.cells.length / 7 }, (_, row) => (
            <tr key={row}>
              {m.cells.slice(row * 7, row * 7 + 7).map((c) => (
                <td key={c.key} className="p-0">
                  <Link
                    href={href({ view: "day", date: c.key })}
                    aria-label={`${longDate(c.key, { weekday: "long", day: "numeric", month: "long" })}: ${c.closed && c.count === 0 ? "closed" : `${c.count} booking${c.count === 1 ? "" : "s"}`}`}
                    className={`flex aspect-square flex-col items-center justify-center rounded-xl border text-sm ${c.today ? "border-brand-900" : "border-border"} ${c.inMonth ? "bg-card" : "bg-surface text-ink-muted"} ${c.closed ? "opacity-60" : ""}`}
                  >
                    <span className="font-bold">{c.day}</span>
                    {c.count > 0 ? <Badge tone="green">{c.count}</Badge> : <span className="text-[10px]">{c.closed ? "closed" : " "}</span>}
                  </Link>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
  };
}

function PrevNext({ label, prev, next, title }: { label: string; prev: string; next: string; title: string }) {
  return (
    <nav aria-label={`Change ${label}`} className="flex items-center justify-between gap-2">
      <Link href={prev} className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold">
        ← Previous {label}
      </Link>
      <span className="text-sm font-bold">{title}</span>
      <Link href={next} className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold">
        Next {label} →
      </Link>
    </nav>
  );
}

function NoBarbers() {
  return (
    <p className="mt-6 rounded-2xl bg-card p-6 text-center text-ink-muted">
      No barbers yet. <Link href="/app/settings#barbers" className="font-semibold text-brand-900 underline">Add one in Settings</Link>.
    </p>
  );
}
