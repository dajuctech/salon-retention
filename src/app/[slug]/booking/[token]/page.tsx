// Booking confirmed + manage booking — design p2, US-11. Reached only through a signed link.
import { Bell, Calendar, Check, Scissors, User, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatShortDate, formatTime, formatWeekday } from "@/domain/format";
import { planAppointmentReminders } from "@/domain/messaging-rules";
import { formatMoney } from "@/domain/money";
import { localDateKey } from "@/domain/time";
import { loadBookingByToken } from "@/server/booking";
import { upcomingDays } from "@/server/slots";
import { forSalon } from "@/server/db";
import { AddToCalendar } from "./add-to-calendar";
import { ManageBooking, PayNow } from "./manage-booking";

// Reads live booking state per request; instant client navigation isn't expected here.
export const instant = false;

export default async function BookingLinkPage({ params }: PageProps<"/[slug]/booking/[token]">) {
  // An expired or tampered link gets a real 404 before streaming.
  await connection();
  const { slug, token } = await params;
  if (!(await loadBookingByToken(slug, token))) notFound();
  return (
    <Suspense fallback={<div className="mx-auto h-72 w-full max-w-md animate-pulse bg-brand-900" />}>
      <BookingLink params={params} />
    </Suspense>
  );
}

async function BookingLink({ params }: { params: PageProps<"/[slug]/booking/[token]">["params"] }) {
  await connection();
  const { slug, token } = await params;
  const data = await loadBookingByToken(slug, token);
  if (!data) notFound();
  const { salon, booking: b } = data;
  const tz = salon.timezone;
  const cancelled = b.status === "CANCELLED";

  const now = new Date();
  const dayDiff = (Date.parse(localDateKey(new Date(b.startsAt), tz)) - Date.parse(localDateKey(now, tz))) / 86_400_000;
  const seeYou = dayDiff === 0 ? "today" : dayDiff === 1 ? "tomorrow" : `on ${formatWeekday(b.startsAt, tz)}`;

  const reminders = planAppointmentReminders(new Date(b.startsAt), new Date(b.createdAt), {
    timeZone: tz,
    dayBeforeOn: salon.dayBeforeReminderOn,
    dayBeforeHour: salon.dayBeforeReminderHour,
    shortOn: salon.shortReminderOn,
    shortHours: salon.shortReminderHours,
  }).map((r) => r.type);
  const reminderText =
    reminders.length === 2
      ? `We'll remind you on WhatsApp the day before and again ${salon.shortReminderHours} hours ahead.`
      : reminders[0] === "REMINDER_2H"
        ? `We'll remind you on WhatsApp ${salon.shortReminderHours} hours ahead.`
        : reminders[0] === "REMINDER_DAY_BEFORE"
          ? "We'll remind you on WhatsApp the day before."
          : null;

  const days = b.canChange ? await upcomingDays(forSalon(salon.id), tz, 14) : [];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      <header className="bg-brand-900 px-5 pb-24 pt-12 text-center text-white">
        <div
          className={`mx-auto flex size-16 items-center justify-center rounded-full ${cancelled ? "bg-white/15 text-white" : "bg-accent-500 text-brand-900"}`}
        >
          {cancelled ? <X className="size-8" strokeWidth={3} aria-hidden /> : <Check className="size-8" strokeWidth={3} aria-hidden />}
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">
          {cancelled ? "Booking cancelled" : `You're booked, ${b.firstName}`}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-white/85">
          {cancelled
            ? "Your appointment has been cancelled. We hope to see you another time."
            : `We've sent the details to your WhatsApp. See you ${seeYou}.`}
        </p>
      </header>

      <main className="-mt-16 flex flex-1 flex-col px-5 pb-8">
        <section className="rounded-3xl bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Booking ref</p>
            <p className="rounded-full bg-accent-50 px-3 py-1 text-sm font-bold text-[#7a5a12]">{b.ref}</p>
          </div>
          <div className={`mt-4 space-y-4 ${cancelled ? "opacity-60" : ""}`}>
            <Row icon={<Calendar className="size-5" />} label="Date and time">
              {formatShortDate(b.startsAt, tz)} · {formatTime(b.startsAt, tz)}
            </Row>
            <Row icon={<Scissors className="size-5" />} label="Service">
              {b.serviceName} · {b.durationMin} min
            </Row>
            <Row icon={<User className="size-5" />} label="Barber">
              {b.barberName}
            </Row>
          </div>
          {!cancelled && (
            <div className="mt-5 flex items-center justify-between border-t border-dashed border-border pt-4">
              <p className="text-ink-muted">{b.paymentStatus === "PAID" ? "Paid ✓" : b.canPayOnline ? "Pay now or at the salon" : "Pay at the salon"}</p>
              <p className="text-2xl font-bold">{formatMoney(b.paymentStatus === "PAID" ? b.priceMinor : b.balanceMinor, b.currency)}</p>
            </div>
          )}
          {b.canPayOnline && <PayNow slug={slug} token={token} label={`Pay ${formatMoney(b.balanceMinor, b.currency)} now`} />}
        </section>

        {reminderText && !cancelled && (
          <p className="mt-4 flex gap-3 rounded-2xl bg-accent-50 p-4 text-sm">
            <Bell className="size-5 shrink-0 text-[#7a5a12]" aria-hidden />
            {reminderText}
          </p>
        )}

        <div className="mt-auto space-y-3 pt-8">
          {!cancelled && (
            <AddToCalendar
              title={`${b.serviceName} at ${salon.name}`}
              startsAt={b.startsAt}
              endsAt={b.endsAt}
              description={`Booking ref ${b.ref} with ${b.barberName}`}
            />
          )}
          {b.canChange ? (
            <ManageBooking slug={slug} token={token} timeZone={tz} days={days} currentStart={b.startsAt} />
          ) : (
            !cancelled && (
              <p className="rounded-2xl bg-card p-4 text-center text-sm text-ink-muted">
                Need to change it? It&apos;s less than {Math.round(salon.cancelCutoffMinutes / 60)} hours to go, so please
                contact the salon.
              </p>
            )
          )}
          <Link href={`/${slug}`} className="block py-2 text-center font-semibold text-brand-900 underline">
            Book another time
          </Link>
        </div>
      </main>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-900" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="font-bold">{children}</p>
      </div>
    </div>
  );
}
