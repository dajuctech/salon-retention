"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { customerFromConversationAction, handledAction, replyAction } from "../../../actions";
import { ActionButton, Flash } from "../../../ui-client";

export function ThreadActions({
  conversationId,
  hasCustomer,
  windowOpen,
  hoursLeft,
  handled,
}: {
  conversationId: string;
  hasCustomer: boolean;
  windowOpen: boolean;
  hoursLeft: number;
  handled: boolean;
}) {
  const [reply, replyFormAction] = useActionState(replyAction.bind(null, conversationId), null);
  const [create, createFormAction] = useActionState(customerFromConversationAction.bind(null, conversationId), null);

  if (!hasCustomer) {
    return (
      <form action={createFormAction} className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">Unknown number</p>
        <p className="text-sm text-ink-muted">Add them as a customer to reply.</p>
        <Flash state={create} />
        <label className={labelClass} htmlFor="name">
          Name
        </label>
        <input id="name" name="name" required className={inputClass} />
        <SubmitButton className={primaryButton} pendingText="Saving…">
          Create customer
        </SubmitButton>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {windowOpen ? (
        <form action={replyFormAction} className="space-y-2">
          <Flash state={reply} />
          <label className={labelClass} htmlFor="text">
            Reply <span className="font-normal text-ink-muted">· window open, {hoursLeft}h left</span>
          </label>
          <textarea id="text" name="text" rows={3} maxLength={1000} required className={inputClass} />
          <SubmitButton className={primaryButton} pendingText="Sending…">
            Send reply
          </SubmitButton>
        </form>
      ) : (
        <p className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
          The 24-hour reply window has closed. WhatsApp only allows approved templates until the customer writes again.
        </p>
      )}
      {!handled && (
        <ActionButton action={() => handledAction(conversationId)} className={outlineButton}>
          Mark handled
        </ActionButton>
      )}
    </div>
  );
}
