// AI copy assistant (US-30, ai-design.md §3 A1) and owner-approved template wording (US-22 AC5).
// AI never sends anything: drafts pass code guardrails, the owner edits and saves, and a saved
// wording becomes a new template version that WhatsApp must approve.
import { checkDraft } from "@/domain/ai-guardrails";
import { buildTemplate, metaBodyProblem, templateToWording } from "@/domain/template-builder";
import { templateFor } from "@/domain/templates";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import { forSalon } from "@/server/db";
import { AIRefusalError, type CopyGoal, type CopyTone, type TextGenerator } from "@/server/ai/generator";
import { COPY_PROMPT_VERSION } from "@/server/ai/prompts";
import { getGenerator } from "@/server/ai/providers";
import { fail, ok, staffAudit, type StaffCtx } from "./context";
import { activeOffer, type Variant } from "./messaging";

export const MAX_LENGTH = 320;
export const EDITABLE = [
  { variant: "friendly", label: "Win-back · Friendly" },
  { variant: "short", label: "Win-back · Short" },
  { variant: "with_offer", label: "Win-back · With offer" },
] as const;

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The wording currently used for each win-back variant (the salon's own, else the platform's). */
export async function editableTemplates(ctx: StaffCtx) {
  assertCan(ctx.member, "ai.copyAssistant");
  const db = forSalon(ctx.member.salonId);
  const rows = await db.messageTemplate.findMany({ where: { type: "WINBACK" }, orderBy: [{ salonId: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] });
  return EDITABLE.map((e) => {
    const approved = rows.find((r) => r.variant === e.variant && r.approval === "APPROVED");
    const pending = rows.find((r) => r.variant === e.variant && r.salonId && (r.approval === "PENDING" || r.approval === "DRAFT"));
    const fallback = templateFor("WINBACK", e.variant)!;
    return {
      ...e,
      current: approved ? templateToWording(approved.body, approved.variables) : templateToWording(fallback.body, fallback.variables),
      own: Boolean(approved?.salonId),
      pending: pending ? templateToWording(pending.body, pending.variables) : null,
    };
  });
}

export async function draftCopy(
  ctx: StaffCtx,
  input: { variant: Variant; tone: CopyTone; ownerBrief?: string; goal?: "winback" | "promotion"; promotionLine?: string },
  generator: TextGenerator = getGenerator(),
  now = new Date(),
) {
  assertCan(ctx.member, "ai.copyAssistant");
  const db = forSalon(ctx.member.salonId);
  const spent = await db.aIGeneration.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { costMicroUsd: true } });
  if ((spent._sum.costMicroUsd ?? 0) >= ctx.salon.aiMonthlyBudgetMicroUsd) {
    return fail("This month's AI budget is used up. You can still write the wording yourself.");
  }
  const goal: CopyGoal = input.goal ?? "winback";
  const offer =
    goal === "promotion"
      ? input.promotionLine
        ? { line: input.promotionLine }
        : null
      : input.variant === "with_offer"
        ? await activeOffer(db, ctx.salon, now)
        : null;
  if ((input.variant === "with_offer" || goal === "promotion") && !offer) return fail("Create an offer in Settings first.");
  const request = {
    goal,
    tone: input.tone,
    maxLength: input.variant === "short" ? 160 : MAX_LENGTH,
    salonName: ctx.salon.name,
    promotion: offer ? { description: offer.line } : null,
    ownerBrief: input.ownerBrief?.trim().slice(0, 300) || undefined,
  };
  // Offer campaigns get the booking link from their template, so drafts must not include one.
  const rules = { maxLength: request.maxLength, promotionProvided: Boolean(offer), requireBookingLink: goal !== "promotion" };
  const started = Date.now();
  const log = (data: object) =>
    db.aIGeneration.create({
      data: {
        salonId: ctx.member.salonId,
        feature: "copy_assistant",
        promptVersion: COPY_PROMPT_VERSION,
        provider: generator.provider,
        model: generator.model,
        input: request, // salon-level facts only, no customer data (ai-design.md §4)
        latencyMs: Date.now() - started,
        ...data,
      },
    });

  let result;
  try {
    result = await generator.draft(request, AbortSignal.timeout(15_000));
  } catch (err) {
    await log({ error: err instanceof AIRefusalError ? "refused" : String((err as Error)?.message ?? err).slice(0, 300) });
    return fail("Suggestions aren't available right now. You can write the wording yourself.");
  }
  const checked = result.drafts.map((text) => ({ text, ...checkDraft(text, rules) }));
  const passing = checked.filter((c) => c.ok && !(goal === "promotion" && c.text.includes("{{booking_link}}"))).map((c) => c.text);
  const generation = await log({
    model: result.model,
    rawOutput: result.drafts,
    guardrailResults: checked.map((c) => c.violations),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costMicroUsd: result.costMicroUsd,
  });
  if (passing.length === 0) return fail("None of the suggestions met the message rules. Try again or write it yourself.");
  return { ok: true as const, value: { generationId: generation.id, drafts: passing } };
}

/**
 * The AI feedback loop (ai-design.md §6): which draft the owner picked, the text they finally
 * approved (edited or not), and who approved it. Feeds `pnpm ai:report`.
 */
export async function recordAIOutcome(ctx: StaffCtx, input: { generationId?: string; pickedDraft?: string; finalText: string }) {
  if (!input.generationId) return;
  const db = forSalon(ctx.member.salonId);
  const gen = await db.aIGeneration.findFirst({ where: { id: input.generationId }, select: { id: true, rawOutput: true } });
  if (!gen) return;
  const raw = Array.isArray(gen.rawOutput) ? (gen.rawOutput as unknown[]) : [];
  const index = input.pickedDraft ? raw.indexOf(input.pickedDraft) : -1;
  await db.aIGeneration.update({
    where: { id: gen.id },
    data: { selectedIndex: index >= 0 ? index : null, finalText: input.finalText, approvedById: ctx.member.userId },
  });
}

/** Saves owner-approved wording as a new template version (BR-PR2 and guardrails still apply). */
export async function saveWording(ctx: StaffCtx, input: { variant: Variant; wording: string; generationId?: string; pickedDraft?: string }) {
  assertCan(ctx.member, "ai.copyAssistant");
  const wording = input.wording.trim();
  const withOffer = input.variant === "with_offer";
  const check = checkDraft(wording.replace(/\s*Reply STOP to opt out\.?\s*$/i, ""), {
    maxLength: input.variant === "short" ? 200 : 400,
    promotionProvided: withOffer,
    requireBookingLink: true,
  });
  if (!check.ok) {
    const v = check.violations[0];
    const why = v.startsWith("unknown_placeholder")
      ? `Unknown placeholder ${v.split(":")[1]}.`
      : ({
          literal_offer: "Offers can't be typed in. Use {{offer}} in the 'with offer' version.",
          offer_without_promotion: "Only the 'with offer' version can use {{offer}}.",
          too_long: "That's too long for a WhatsApp nudge.",
          missing_booking_link: "Include {{booking_link}} so they can book.",
          blocked_term: "Please avoid pressure words and health claims.",
          contains_optout_footer: "The opt-out line is added automatically.",
          malformed_placeholder: "A placeholder is missing its double braces, like {{first_name}}.",
          empty: "Write the message first.",
        } as Record<string, string>)[v] ?? "That wording breaks the message rules.";
    return fail(why);
  }
  if (withOffer && !wording.includes("{{offer}}")) return fail("The 'with offer' version must include {{offer}}.");

  const { body, variables } = buildTemplate(wording, { marketing: true });
  const metaProblem = metaBodyProblem(body);
  if (metaProblem === "starts_with_variable") return fail("Start with a word, not a placeholder, e.g. \"Hi {{first_name}}\". WhatsApp rejects it otherwise.");
  if (metaProblem) return fail("Put at least one word between two placeholders, e.g. \"{{offer}} Book: {{booking_link}}\". WhatsApp rejects it otherwise.");
  const db = forSalon(ctx.member.salonId);
  const versions = await db.messageTemplate.count({ where: { salonId: ctx.member.salonId, type: "WINBACK", variant: input.variant } });
  // With the console provider there's no Meta review, so the wording is usable at once.
  const approval = (process.env.MESSAGING_PROVIDER ?? "console") === "console" ? "APPROVED" : "PENDING";
  const t = await db.messageTemplate.create({
    data: {
      salonId: ctx.member.salonId,
      name: `winback_${input.variant}_${ctx.salon.slug.replace(/-/g, "_")}_v${versions + 1}`.slice(0, 60),
      variant: input.variant,
      type: "WINBACK",
      category: "MARKETING",
      body,
      variables,
      approval,
      aiGenerationId: input.generationId ?? null,
    },
  });
  await recordAIOutcome(ctx, { generationId: input.generationId, pickedDraft: input.pickedDraft, finalText: wording });
  await audit(db, { ...staffAudit(ctx), action: "template.saved", entityType: "MessageTemplate", entityId: t.id, after: { variant: input.variant, approval } });
  return ok;
}
