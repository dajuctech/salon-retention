"use client";

// Small client helpers shared by staff screens.
import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionState } from "./actions";

export function Flash({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl bg-status-danger px-4 py-3 text-sm text-status-danger-ink">
        {state.error}
      </p>
    );
  }
  if (state.info) {
    return (
      <div role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
        <p>{state.info}</p>
        {state.link && <CopyLink link={state.link} />}
      </div>
    );
  }
  return null;
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      <input readOnly value={link} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1 text-xs" aria-label="Link" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        className="rounded-lg bg-brand-900 px-3 py-1 text-xs font-semibold text-white"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** A button that runs a server action, with optional confirmation, and shows the result. */
export function ActionButton({
  action,
  children,
  className,
  confirm,
  pendingText,
  showResult = true,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  className: string;
  confirm?: string;
  pendingText?: string;
  showResult?: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <div className="contents">
      <button
        type="button"
        disabled={pending}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState(await action()));
        }}
      >
        {pending ? (pendingText ?? "Working…") : children}
      </button>
      {showResult && state?.error && (
        <p role="alert" className="col-span-full mt-1 text-sm text-status-danger-ink">
          {state.error}
        </p>
      )}
    </div>
  );
}

/** Submits a form as soon as any input changes (toggle rows on the WhatsApp screen). */
export function AutoSubmitForm({ action, children, className }: { action: (f: FormData) => Promise<void>; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={ref}
      className={className}
      aria-busy={pending}
      onChange={() => start(async () => action(new FormData(ref.current!)))}
      onSubmit={(e) => e.preventDefault()}
    >
      {children}
    </form>
  );
}

/** Scrolls an element into view once (e.g. the selected day in the calendar). */
export function ScrollIntoView({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, [id]);
  return null;
}
