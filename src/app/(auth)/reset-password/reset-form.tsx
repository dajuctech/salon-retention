"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, primaryButton } from "@/components/ui";
import { resetPasswordAction } from "../actions";
import { FormMessage } from "../auth-shell";

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, action] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state?.error ?? (token ? undefined : "This link is incomplete. Ask for a new reset email.")} />
      <input type="hidden" name="token" value={token} />
      <div>
        <label className={labelClass} htmlFor="password">
          New password
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
        <p className="mt-1 text-sm text-ink-muted">At least 10 characters. You&apos;ll be signed out on other devices.</p>
      </div>
      <SubmitButton className={primaryButton} pendingText="Saving…">
        Save password
      </SubmitButton>
    </form>
  );
}
