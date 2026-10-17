// US-01 owner sign-up: account + salon in one step (UI_UX_DESIGN_PLAN §3.8, simplified).
import { connection } from "next/server";
import { Suspense } from "react";
import { COUNTRIES } from "@/domain/countries";
import { currentUser } from "@/server/auth/session";
import { AuthShell } from "../auth-shell";
import { SignUpForm } from "./signup-form";

export const metadata = { title: "Create your salon · Salon Retention & Booking" };

export default function SignUpPage() {
  return (
    <AuthShell eyebrow="Get started" title="Create your salon" subtitle="Bookings, reminders and returning customers in one place.">
      <Suspense>
        <SignUp />
      </Suspense>
    </AuthShell>
  );
}

async function SignUp() {
  await connection();
  const user = await currentUser();
  const countries = Object.entries(COUNTRIES).map(([code, c]) => ({ code, name: c.name }));
  return <SignUpForm signedInAs={user ? { name: user.name, email: user.email } : null} countries={countries} />;
}
