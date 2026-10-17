// New booking (staff) — UI_UX_DESIGN_PLAN §3.2, US-12.
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { requireStaff } from "@/server/auth/session";
import { forSalon } from "@/server/db";
import { newBookingData } from "@/server/staff/queries/bookings";
import { NewBookingForm } from "./new-booking-form";

export const instant = false;

export default function NewBookingPage({ searchParams }: PageProps<"/app/bookings/new">) {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <NewBooking searchParams={searchParams} />
    </Suspense>
  );
}

async function NewBooking({ searchParams }: { searchParams: PageProps<"/app/bookings/new">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const sp = await searchParams;
  const data = await newBookingData(s);
  const preselected =
    typeof sp.customer === "string"
      ? await forSalon(s.member.salonId).customer.findFirst({ where: { id: sp.customer, anonymisedAt: null }, select: { id: true, name: true } })
      : null;
  const date = typeof sp.date === "string" && data.days.some((d) => d.key === sp.date) ? sp.date : (data.days.find((d) => !d.closed)?.key ?? data.days[0].key);
  return (
    <>
      <PageHeader title="New booking" subtitle="For a customer on the phone or at the desk" back={{ href: "/app/calendar", label: "Calendar" }} />
      <div className="px-5 pt-5">
        <NewBookingForm
          services={data.services}
          barbers={data.barbers}
          days={data.days}
          initialDate={date}
          initialCustomer={preselected}
          isBarber={s.member.role === "barber"}
          currency={s.salon.currency}
          timeZone={s.salon.timezone}
        />
      </div>
    </>
  );
}
