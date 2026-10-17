"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { requestResetAction, sendCodeAction, signInAction, verifyCodeAction, verifyTwoFactorAction } from "../actions";
import { FormMessage } from "../auth-shell";

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const [mode, setMode] = useState<"password" | "code" | "reset">("password");
  const [email, setEmail] = useState("");
  const [signIn, signInFormAction] = useActionState(signInAction, null);
  const [code, sendCodeFormAction] = useActionState(sendCodeAction, null);
  const [verify, verifyFormAction] = useActionState(verifyCodeAction, null);
  const [reset, resetFormAction] = useActionState(requestResetAction, null);
  const [twoFa, twoFaFormAction] = useActionState(verifyTwoFactorAction, null);
  const [useBackup, setUseBackup] = useState(false);

  // Second step when two-step sign-in is on (after password or email code).
  if (signIn?.step === "totp" || verify?.step === "totp" && !verify.error || twoFa?.step === "totp") {
    return (
      <form action={twoFaFormAction} className="space-y-4">
        <FormMessage error={twoFa?.error} info={twoFa?.error ? undefined : "Enter the 6-digit code from your authenticator app."} />
        <input type="hidden" name="next" value={next} />
        {useBackup && <input type="hidden" name="backup" value="on" />}
        <div>
          <label className={labelClass} htmlFor="code">
            {useBackup ? "Backup code" : "Code from your app"}
          </label>
          <input id="code" name="code" autoComplete="one-time-code" inputMode={useBackup ? "text" : "numeric"} required autoFocus className={`${inputClass} tracking-[0.3em]`} />
        </div>
        {!useBackup && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="trust" className="size-5 accent-brand-900" />
            Don&apos;t ask again on this phone for 30 days
          </label>
        )}
        <SubmitButton className={primaryButton} pendingText="Checking…">
          Continue
        </SubmitButton>
        <button type="button" onClick={() => setUseBackup((v) => !v)} className={outlineButton}>
          {useBackup ? "Use the app code instead" : "Lost your phone? Use a backup code"}
        </button>
      </form>
    );
  }

  const emailField = (
    <>
      <label className={labelClass} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputClass}
      />
    </>
  );

  if (mode === "code") {
    const codeSent = code?.step === "code" || verify?.step === "code";
    return (
      <div>
        {!codeSent ? (
          <form action={sendCodeFormAction} className="space-y-4">
            <FormMessage error={code?.error} />
            <div>{emailField}</div>
            <SubmitButton className={primaryButton} pendingText="Sending…">
              Email me a code
            </SubmitButton>
          </form>
        ) : (
          <form action={verifyFormAction} className="space-y-4">
            <FormMessage error={verify?.error} info={verify?.error ? undefined : code?.info} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />
            <div>
              <label className={labelClass} htmlFor="otp">
                6-digit code
              </label>
              <input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${inputClass} tracking-[0.5em]`} />
            </div>
            <SubmitButton className={primaryButton} pendingText="Checking…">
              Sign in
            </SubmitButton>
          </form>
        )}
        <button type="button" onClick={() => setMode("password")} className={`${outlineButton} mt-4`}>
          Use my password instead
        </button>
      </div>
    );
  }

  if (mode === "reset") {
    return (
      <form action={resetFormAction} className="space-y-4">
        <FormMessage error={reset?.error} info={reset?.info} />
        <p className="text-sm text-ink-muted">We&apos;ll email you a link to choose a new password.</p>
        <div>{emailField}</div>
        <SubmitButton className={primaryButton} pendingText="Sending…">
          Send reset link
        </SubmitButton>
        <button type="button" onClick={() => setMode("password")} className={outlineButton}>
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form action={signInFormAction} className="space-y-4">
      <FormMessage
        error={signIn?.error}
        info={params.get("reset") ? "Password changed. Sign in with your new password." : undefined}
      />
      <input type="hidden" name="next" value={next} />
      <div>{emailField}</div>
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass} htmlFor="password">
            Password
          </label>
          <button type="button" onClick={() => setMode("reset")} className="text-sm font-semibold text-brand-900 underline">
            Forgot password?
          </button>
        </div>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" name="remember" defaultChecked className="size-5 accent-brand-900" />
        Keep me signed in on this phone
      </label>
      <SubmitButton className={primaryButton} pendingText="Signing in…">
        Sign in
      </SubmitButton>
      <div className="flex items-center gap-3 text-sm text-ink-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <button type="button" onClick={() => setMode("code")} className={outlineButton}>
        Sign in with a one-time code
      </button>
      <p className="pt-2 text-center text-sm">
        New salon?{" "}
        <Link href="/signup" className="font-semibold text-brand-900 underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
