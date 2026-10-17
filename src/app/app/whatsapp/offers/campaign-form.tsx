"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import { Card, inputClass, labelClass, outlineButton, primaryButton } from "@/components/ui";
import { previewCampaignAction, sendCampaignAction, suggestCampaignWordingAction } from "../../actions";
import { Flash } from "../../ui-client";

export function CampaignForm({ promotions, segments }: { promotions: { id: string; name: string }[]; segments: { key: string; label: string }[] }) {
  const [promotionId, setPromotionId] = useState(promotions[0].id);
  const [segment, setSegment] = useState(segments[0].key);
  const [wording, setWording] = useState("Hi {{first_name}}, {{salon_name}} has something for you: {{offer}}");
  const [preview, previewAction] = useActionState(previewCampaignAction, null);
  const [sent, sendAction] = useActionState(sendCampaignAction, null);
  const [suggest, suggestAction] = useActionState(suggestCampaignWordingAction, null);
  // Which AI draft the wording came from, for the AI feedback log (not part of the preview key).
  const [ai, setAi] = useState({ generationId: "", picked: "" });
  // A preview only counts for exactly what was previewed.
  const [previewedKey, setPreviewedKey] = useState("");
  const key = `${promotionId}|${segment}|${wording}`;
  const canSend = preview && !preview.error && !preview.wordingError && (preview.recipients ?? 0) > 0 && previewedKey === key;

  const hidden = (
    <>
      <input type="hidden" name="promotionId" value={promotionId} />
      <input type="hidden" name="segment" value={segment} />
      <input type="hidden" name="wording" value={wording} />
    </>
  );

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div>
          <label className={labelClass} htmlFor="promo">Offer</label>
          <select id="promo" value={promotionId} onChange={(e) => setPromotionId(e.target.value)} className={inputClass}>
            {promotions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="segment">Send to</label>
          <select id="segment" value={segment} onChange={(e) => setSegment(e.target.value)} className={inputClass}>
            {segments.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="wording">Message</label>
          <textarea id="wording" rows={3} maxLength={300} value={wording} onChange={(e) => setWording(e.target.value)} className={inputClass} />
          <p className="mt-1 text-xs text-ink-muted">Use {"{{first_name}}"}, {"{{salon_name}}"} and {"{{offer}}"}. The booking link and “Reply STOP to opt out.” are added automatically.</p>
        </div>
      </Card>

      <form action={suggestAction} className="space-y-2 rounded-2xl border border-dashed border-border bg-card p-4">
        <p className="text-sm font-semibold">Suggest wording (AI)</p>
        <input type="hidden" name="promotionId" value={promotionId} />
        <div className="grid grid-cols-2 gap-2">
          <select name="tone" aria-label="Tone" defaultValue="friendly" className={inputClass}>
            <option value="friendly">Friendly</option>
            <option value="professional">Professional</option>
            <option value="playful">Playful</option>
          </select>
          <input name="brief" maxLength={300} placeholder="e.g. quiet Mondays" aria-label="Note for the suggestion" className={inputClass} />
        </div>
        <SubmitButton className={outlineButton} pendingText="Thinking…">Suggest versions</SubmitButton>
        <Flash state={suggest?.error ? { error: suggest.error } : null} />
        {suggest?.drafts && (
          <ul className="space-y-2" aria-label="Suggestions">
            {suggest.drafts.map((d, i) => (
              <li key={i} className="rounded-xl bg-brand-50 p-3 text-sm">
                <p>{d}</p>
                <button
                  type="button"
                  onClick={() => {
                    setWording(d);
                    setAi({ generationId: suggest.generationId ?? "", picked: d });
                  }}
                  className="mt-1 font-semibold text-brand-900 underline"
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <form action={(f) => { setPreviewedKey(key); previewAction(f); }}>
        {hidden}
        <SubmitButton className={outlineButton} pendingText="Checking…">Preview who gets it</SubmitButton>
      </form>

      {preview && (
        <Card className="space-y-3 p-4" aria-live="polite">
          {preview.error || preview.wordingError ? (
            <Flash state={{ error: preview.error ?? preview.wordingError ?? "" }} />
          ) : (
            <>
              <p className="text-lg font-bold">{preview.recipients} of {preview.total} customers will get this</p>
              <ul className="text-sm text-ink-muted">
                {preview.excluded!.noConsent > 0 && <li>{preview.excluded!.noConsent} haven&apos;t agreed to offers</li>}
                {preview.excluded!.capped > 0 && <li>{preview.excluded!.capped} already had a message this week</li>}
                {preview.excluded!.holdout > 0 && <li>{preview.excluded!.holdout} are in the comparison group (to measure results)</li>}
                {preview.excluded!.badNumber > 0 && <li>{preview.excluded!.badNumber} have a number that isn&apos;t on WhatsApp</li>}
              </ul>
              <p className="text-sm">Estimated cost ≈ ${preview.costUsd?.toFixed(2)}</p>
              {preview.preview && (
                <div className="rounded-2xl bg-brand-900 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/80">Example message</p>
                  <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900 [overflow-wrap:anywhere]">{preview.preview}</p>
                </div>
              )}
              {previewedKey !== key && <p className="text-sm text-status-danger-ink">You changed something. Preview again before sending.</p>}
            </>
          )}
        </Card>
      )}

      <form
        action={sendAction}
        onSubmit={(e) => {
          if (!window.confirm(`Send this offer to ${preview?.recipients} customers now? Estimated cost ≈ $${preview?.costUsd?.toFixed(2)}.`)) e.preventDefault();
        }}
      >
        {hidden}
        <input type="hidden" name="generationId" value={ai.generationId} />
        <input type="hidden" name="pickedDraft" value={ai.picked} />
        <Flash state={sent} />
        <button type="submit" disabled={!canSend} className={primaryButton}>
          {canSend ? `Approve and send to ${preview!.recipients}` : "Preview first"}
        </button>
      </form>
    </div>
  );
}
