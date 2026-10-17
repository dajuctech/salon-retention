"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, primaryButton } from "@/components/ui";
import { acceptInviteAction } from "../../actions";
import { FormMessage } from "../../auth-shell";

export function AcceptInviteForm({ token, needsAccount }: { token: string; needsAccount: boolean }) {
  const [state, action] = useActionState(acceptInviteAction.bind(null, token), null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state?.error} />
      {needsAccount && (
        <>
          <div>
            <label className={labelClass} htmlFor="name">
              Your name
            </label>
            <input id="name" name="name" autoComplete="name" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="password">
              Choose a password
            </label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
            <p className="mt-1 text-sm text-ink-muted">At least 10 characters.</p>
          </div>
        </>
      )}
      <SubmitButton className={primaryButton} pendingText="Joining…">
        {needsAccount ? "Create account and join" : "Accept invitation"}
      </SubmitButton>
    </form>
  );
}
