"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { saveWordingAction, suggestWordingAction } from "../../actions";
import { Flash } from "../../ui-client";

type Variant = "friendly" | "short" | "with_offer";

export function WordingEditor({ variant, label, current, pending, own }: { variant: Variant; label: string; current: string; pending: string | null; own: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current);
  const [generationId, setGenerationId] = useState<string>("");
  const [picked, setPicked] = useState<string>("");
  const [suggest, suggestAction] = useActionState(suggestWordingAction.bind(null, variant), null);
  const [save, saveAction] = useActionState(saveWordingAction.bind(null, variant), null);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{label}</h2>
        <span className="text-xs text-ink-muted">{own ? "Your wording" : "Standard wording"}</span>
      </div>
      <p className="rounded-xl bg-surface p-3 text-sm">{current}</p>
      {pending && <p className="text-xs text-ink-muted">Waiting for WhatsApp approval: “{pending}”</p>}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={outlineButton}>
          Change wording
        </button>
      ) : (
        <>
          <form action={suggestAction} className="space-y-2 rounded-xl border border-dashed border-border p-3">
            <p className="text-sm font-semibold">Suggest wording (AI)</p>
            <div className="grid grid-cols-2 gap-2">
              <select name="tone" aria-label="Tone" defaultValue="friendly" className={inputClass}>
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="playful">Playful</option>
              </select>
              <input name="brief" maxLength={300} placeholder="Anything to mention?" aria-label="Note for the suggestion" className={inputClass} />
            </div>
            <SubmitButton className={outlineButton} pendingText="Thinking…">
              Suggest 3 versions
            </SubmitButton>
            <Flash state={suggest?.error ? { error: suggest.error } : null} />
            {suggest?.drafts && (
              <ul className="space-y-2" aria-label="Suggestions">
                {suggest.drafts.map((d, i) => (
                  <li key={i} className="rounded-xl bg-brand-50 p-3 text-sm">
                    <p>{d}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setText(d);
                        setPicked(d);
                        setGenerationId(suggest.generationId ?? "");
                      }}
                      className="mt-1 font-semibold text-brand-900 underline"
                    >
                      Use this
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-muted">AI-suggested. Only suggestions that pass the message rules are shown. Nothing is sent.</p>
          </form>
          <form action={saveAction} className="space-y-2">
            <Flash state={save} />
            <input type="hidden" name="generationId" value={generationId} />
            <input type="hidden" name="pickedDraft" value={picked} />
            <label className={labelClass} htmlFor={`w-${variant}`}>
              Wording
            </label>
            <textarea id={`w-${variant}`} name="wording" rows={4} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} />
            <p className="text-xs text-ink-muted">{text.length} characters · “Reply STOP to opt out.” is added automatically.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className={outlineButton}>
                Close
              </button>
              <SubmitButton className={primaryButton}>Save wording</SubmitButton>
            </div>
          </form>
        </>
      )}
    </Card>
  );
}
