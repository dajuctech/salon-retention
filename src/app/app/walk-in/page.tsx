// Walk-in quick capture — UI_UX_DESIGN_PLAN §3.1, US-09 (target ≤ 10 seconds).
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { requireStaff } from "@/server/auth/session";
import { newBookingData } from "@/server/staff/queries/bookings";
import { WalkInForm } from "./walk-in-form";

export const instant = false;

export default function WalkInPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <WalkIn />
    </Suspense>
  );
}

async function WalkIn() {
  await connection();
  const s = await requireStaff();
  const data = await newBookingData(s);
  return (
    <>
      <PageHeader title="Walk-in" subtitle="Record who's in the chair" back={{ href: "/app", label: "Home" }} />
      <div className="px-5 pt-5">
        <WalkInForm services={data.services} barbers={data.barbers} isBarber={s.member.role === "barber"} currency={s.salon.currency} />
      </div>
    </>
  );
}
