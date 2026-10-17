"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { approveAction, skipDraftAction, variantAction, type ActionState } from "../../actions";
import { Flash } from "../../ui-client";

type Draft = {
  id: string;
  index: number;
  customerId: string;
  name: string;
  whyNow: string | null;
  text: string;
  variant: "friendly" | "short" | "with_offer";
};

const VARIANTS = [
  { key: "friendly", label: "Friendly" },
  { key: "short", label: "Short" },
  { key: "with_offer", label: "With offer" },
] as const;

export function DraftCard({ draft, total, hasOffer }: { draft: Draft; total: number; hasOffer: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const [scheduling, setScheduling] = useState(false);
  const [approveState, approve] = useActionState(approveAction.bind(null, [draft.id]), null);
  const initials = draft.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <article id={draft.id} className="scroll-mt-4 rounded-2xl border-2 border-brand-900 bg-card p-4" aria-label={`Draft ${draft.index} of ${total}: ${draft.name}`}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-900" aria-hidden>
          {initials}
        </span>
        <span className="flex-1">
          <Link href={`/app/customers/${draft.customerId}`} className="block text-lg font-bold">
            {draft.name}
          </Link>
          <span className="block text-sm text-ink-muted">
            {draft.index} of {total} · Win-back
          </span>
        </span>
        <span className="rounded-full bg-status-in-chair px-2.5 py-0.5 text-sm font-semibold text-[#7a5200]">Draft</span>
      </div>
      {draft.whyNow && (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-sm">
          <strong>Why now:</strong> {draft.whyNow}
        </p>
      )}

      <p className="mt-3 text-sm font-semibold">Message version</p>
      <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Message version" aria-busy={pending}>
        {VARIANTS.map((v) => {
          const disabled = v.key === "with_offer" && !hasOffer;
          return (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={draft.variant === v.key}
              disabled={pending || disabled}
              title={disabled ? "Create an offer in Settings first" : undefined}
              onClick={() => start(async () => setState(await variantAction(draft.id, v.key)))}
              className={`rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${draft.variant === v.key ? "border-brand-900 bg-brand-50" : "border-border bg-card"}`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      {!hasOffer && (
        <p className="mt-1 text-xs text-ink-muted">
          &ldquo;With offer&rdquo; needs an active offer. <Link href="/app/settings#offers" className="underline">Create one</Link>.
        </p>
      )}
      <Flash state={state?.error ? state : null} />

      <div className="mt-3 rounded-2xl bg-brand-900 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/80">WhatsApp preview</p>
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900 [overflow-wrap:anywhere]">{draft.text}</p>
        <p className="mt-1 text-right text-xs text-white/70">{draft.text.length} characters</p>
      </div>

      <form action={approve} className="mt-3 space-y-2">
        <Flash state={approveState} />
        {scheduling && (
          <div>
            <label className={labelClass} htmlFor={`at-${draft.id}`}>
              Send at (salon time)
            </label>
            <input id={`at-${draft.id}`} type="datetime-local" name="sendAt" required className={inputClass} />
          </div>
        )}
        <SubmitButton className={primaryButton} pendingText="Approving…">
          {scheduling ? "Approve and schedule" : "Approve and send"}
        </SubmitButton>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setScheduling((v) => !v)} className={outlineButton}>
            {scheduling ? "Send now instead" : "Schedule"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setState(await skipDraftAction(draft.id)))}
            className={`${outlineButton} text-status-danger-ink`}
          >
            Skip this one
          </button>
        </div>
      </form>
    </article>
  );
}

export function ApproveAll({ count, costUsd }: { count: number; costUsd: number }) {
  const [state, action] = useActionState(approveAction.bind(null, "all"), null);
  return (
    <div className="sticky bottom-20 z-10 rounded-2xl border border-border bg-card p-3 shadow-lg">
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm(`Send ${count} message${count === 1 ? "" : "s"} now? Estimated cost about $${costUsd.toFixed(2)}.`)) e.preventDefault();
        }}
      >
        <Flash state={state} />
        <SubmitButton className={primaryButton} pendingText="Approving…">
          Approve all {count} · ≈ ${costUsd.toFixed(2)}
        </SubmitButton>
        <p className="mt-1 text-center text-xs text-ink-muted">Each is re-checked first: anyone who booked or opted out since is skipped.</p>
      </form>
    </div>
  );
}
