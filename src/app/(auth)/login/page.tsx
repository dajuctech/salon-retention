// Staff sign-in — design p3.
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Salon Retention & Booking" };

export default function LoginPage() {
  return (
    <AuthShell eyebrow="Salon staff" title="Welcome back" subtitle="Check today's bookings and bring customers back.">
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-10 text-center text-sm text-ink-muted">
        For salon owners and staff only. Customers book through their salon&apos;s link.
      </p>
    </AuthShell>
  );
}
