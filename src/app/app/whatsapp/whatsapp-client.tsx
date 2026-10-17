"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { autoMessagesAction, messagingPausedAction, retryAction, runJobsNowAction, simulateInboundAction } from "../actions";
import { ActionButton, AutoSubmitForm, Flash } from "../ui-client";

type Settings = {
  dayBeforeReminderOn: boolean;
  dayBeforeReminderHour: number;
  shortReminderOn: boolean;
  shortReminderHours: number;
  birthdayMessageOn: boolean;
  winbackOn: boolean;
};

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? "pm" : "am"}`;

export function AutoToggles({ settings, disabled }: { settings: Settings; disabled: boolean }) {
  const rows = [
    { name: "dayBeforeReminderOn", title: `Day-before reminder (${hourLabel(settings.dayBeforeReminderHour)})`, sub: "Sent the evening before", on: settings.dayBeforeReminderOn },
    { name: "shortReminderOn", title: `${settings.shortReminderHours}-hour reminder`, sub: `Sent ${settings.shortReminderHours} hours before the booking`, on: settings.shortReminderOn },
    { name: "birthdayMessageOn", title: "Birthday message (9am)", sub: "Sent on their birthday, if they agreed to offers", on: settings.birthdayMessageOn },
    { name: "winbackOn", title: "Win-back follow-up", sub: "Drafted when someone is past their usual gap. You approve each one.", on: settings.winbackOn },
  ];
  return (
    <AutoSubmitForm action={autoMessagesAction} className="divide-y divide-border rounded-2xl border border-border bg-card">
      {rows.map((r) => (
        <label key={r.name} className="flex items-center gap-3 px-4 py-3">
          <span className="flex-1">
            <span className="block font-semibold">{r.title}</span>
            <span className="block text-sm text-ink-muted">{r.sub}</span>
          </span>
          <input type="checkbox" role="switch" name={r.name} defaultChecked={r.on} disabled={disabled} className="size-6 accent-brand-900" />
        </label>
      ))}
      {disabled && <p className="px-4 py-2 text-xs text-ink-muted">Only the owner can change these.</p>}
    </AutoSubmitForm>
  );
}

/** Owner's emergency stop for all of this salon's WhatsApp messages. */
export function PauseSending({ paused, platformWide, canEdit }: { paused: boolean; platformWide: boolean; canEdit: boolean }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{paused ? "Sending is paused" : "Sending is on"}</span>
        <span className="block text-sm text-ink-muted">
          {platformWide ? "Paused for all salons by the platform team." : paused ? "Messages wait in the queue until you resume." : "Pause stops every message from this salon at once."}
        </span>
      </span>
      {canEdit && !platformWide && (
        <ActionButton
          action={() => messagingPausedAction(!paused)}
          confirm={paused ? undefined : "Pause all WhatsApp messages from your salon? Reminders won't go out until you resume."}
          className={paused ? primaryButton : outlineButton}
          pendingText={paused ? "Resuming…" : "Pausing…"}
        >
          {paused ? "Resume sending" : "Pause all sending"}
        </ActionButton>
      )}
    </Card>
  );
}

export function FailureActions({ messageId, customerId, notOnWhatsApp }: { messageId: string; customerId: string; notOnWhatsApp: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ActionButton action={() => retryAction(messageId)} className={primaryButton} pendingText="Retrying…">
        Retry
      </ActionButton>
      {notOnWhatsApp ? (
        <Link href={`/app/customers/${customerId}/edit`} className={outlineButton}>
          Fix number
        </Link>
      ) : (
        <Link href={`/app/customers/${customerId}`} className={outlineButton}>
          Open customer
        </Link>
      )}
    </div>
  );
}

/** Development only: run the scheduled jobs now, and simulate a customer reply. */
export function DevTools() {
  const [jobs, runJobs] = useActionState(async () => runJobsNowAction(), null);
  const [sim, simulate] = useActionState(simulateInboundAction, null);
  return (
    <Card className="space-y-3 border-dashed p-4">
      <p className="text-sm font-bold">Developer tools (not shown in production)</p>
      <form action={runJobs} className="space-y-2">
        <Flash state={jobs} />
        <SubmitButton className={outlineButton} pendingText="Running…">
          Run message jobs now
        </SubmitButton>
      </form>
      <form action={simulate} className="space-y-2">
        <Flash state={sim} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="sim-phone">
              Customer phone
            </label>
            <input id="sim-phone" name="phone" className={inputClass} required />
          </div>
          <div>
            <label className={labelClass} htmlFor="sim-text">
              Their message
            </label>
            <input id="sim-text" name="text" className={inputClass} placeholder="STOP, or a question" required />
          </div>
        </div>
        <SubmitButton className={outlineButton} pendingText="Sending…">
          Simulate a customer reply
        </SubmitButton>
      </form>
    </Card>
  );
}
