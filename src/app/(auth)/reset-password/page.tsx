// Choose a new password from the emailed link.
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";
import { ResetForm } from "./reset-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell eyebrow="Salon staff" title="New password" subtitle="Choose a password you don't use anywhere else.">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
