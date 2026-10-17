"use client";

// Two-step sign-in setup (US-01 security; recommended for owners).
import { useActionState } from "react";
import { confirmTwoFactorAction, disableTwoFactorAction, startTwoFactorAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";

export function TwoFactorCard({ enabled, recommended }: { enabled: boolean; recommended: boolean }) {
  const [start, startAction] = useActionState(startTwoFactorAction, null);
  const [confirm, confirmAction] = useActionState(confirmTwoFactorAction, null);
  const [disable, disableAction] = useActionState(disableTwoFactorAction, null);
  const isOn = confirm?.enabled ?? (disable?.enabled === false ? false : enabled);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Two-step sign-in</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${isOn ? "bg-status-confirmed text-brand-900" : "bg-status-done"}`}>{isOn ? "On" : "Off"}</span>
      </div>
      {!isOn && recommended && <p className="text-sm text-ink-muted">Recommended for owners: a code from your phone is needed to sign in, so a stolen password isn&apos;t enough.</p>}
      {(confirm?.info || disable?.info) && <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">{confirm?.info ?? disable?.info}</p>}

      {isOn ? (
        <form action={disableAction} className="space-y-2">
          {disable?.error && <p role="alert" className="text-sm text-status-danger-ink">{disable.error}</p>}
          <label className={labelClass} htmlFor="pw-off">Password to turn it off</label>
          <input id="pw-off" name="password" type="password" autoComplete="current-password" required className={inputClass} />
          <SubmitButton className={outlineButton} pendingText="Turning off…">Turn off</SubmitButton>
        </form>
      ) : !start?.qr ? (
        <form action={startAction} className="space-y-2">
          {start?.error && <p role="alert" className="text-sm text-status-danger-ink">{start.error}</p>}
          <label className={labelClass} htmlFor="pw-on">Confirm your password</label>
          <input id="pw-on" name="password" type="password" autoComplete="current-password" required className={inputClass} />
          <SubmitButton className={primaryButton} pendingText="Setting up…">Turn on</SubmitButton>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={start.qr} alt="QR code for your authenticator app" width={220} height={220} className="mx-auto rounded-xl bg-white" />
          <p className="text-xs text-ink-muted">
            Can&apos;t scan? Enter this key: <code className="select-all break-all">{start.secret}</code>
          </p>
          <div>
            <p className="text-sm">2. Save these backup codes somewhere safe. Each works once if you lose your phone.</p>
            <ul className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-surface p-3 font-mono text-sm" aria-label="Backup codes">
              {start.backupCodes?.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <form action={confirmAction} className="space-y-2">
            {confirm?.error && <p role="alert" className="text-sm text-status-danger-ink">{confirm.error}</p>}
            <label className={labelClass} htmlFor="first-code">3. Enter the 6-digit code from the app</label>
            <input id="first-code" name="code" inputMode="numeric" autoComplete="one-time-code" required className={`${inputClass} tracking-[0.3em]`} />
            <SubmitButton className={primaryButton} pendingText="Checking…">Confirm and turn on</SubmitButton>
          </form>
        </div>
      )}
    </Card>
  );
}
