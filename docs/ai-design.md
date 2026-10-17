# AI Design

## 1. Principles

1. **Software rules decide; AI writes.** Code decides who is messaged, when, why, and with which offer. AI only suggests wording or describes numbers that have already been computed.
2. **The product works with AI switched off.** Every AI feature can fall back to manual text or a fixed template.
3. **A human approves anything a customer will see.** AI output never goes straight to the messaging provider.
4. **Send the model as little data as possible.** Only the fields listed in §4 are sent, and phone numbers never are.
5. **Measure before you trust.** A feature ships only when its eval passes ([evals/README.md](../evals/README.md)), and it is compared against a baseline that uses no AI.

## 2. The WhatsApp constraint

Outside the 24-hour window after a customer's last message, WhatsApp only delivers **pre-approved templates** with variables. So AI **cannot** write a new free-form reminder for each customer. Instead AI is used:

| Where AI helps | How it reaches the customer |
|---|---|
| Drafting the wording of new templates | Owner edits → template submitted to Meta → used automatically once approved |
| Drafting promotion text | Owner edits and approves → sent as the `{{body}}` variable of an approved marketing template, within Meta's variable limits |
| Personalisation | Done with template variables (`{{first_name}}`, `{{barber_name}}`, `{{days_since_visit}}`) filled from the database, not generated per message |

Benefit: one AI call per template or promotion instead of one per customer. Cost is almost zero, and output is consistent.

**How this fits the "Approve messages" screen in the design.** The screen keeps its layout, but each part comes from a different source:

| Screen element | Source |
|---|---|
| "Why now: last visit 5 weeks ago, usually every 3 weeks with Tunde" | **Code** (BR-R3a/b), not AI |
| Message text | The approved win-back template variant, filled with this customer's details |
| Friendly / Short / With offer chips | Switch between approved template variants |
| "Regenerate" | Removed from the draft card. Rewording happens in the template editor (A1), and the new wording needs Meta approval |
| Banner copy | Change it from "AI wrote these from each customer's visit history" to: "These customers are due back. Messages use your approved templates. Nothing sends until you approve." |

The per-customer card doesn't call AI at all, so the queue still works when AI is off or over budget.

## 3. Features

### A1 — AI copy assistant (R1, Should)

- **Input:** goal (`winback | birthday | promotion | reactivation | thank_you`), tone (`friendly | professional | playful`), maximum length, salon name, optional promotion (type, value, valid dates, services), and language.
- **Output (structured):** `{ drafts: [{ text, placeholders_used: string[] }] }`, with 1–3 drafts.
- **Flow:** owner asks for drafts → server calls the model → guardrails (§5) check every draft → owner sees only the drafts that pass, and edits one → owner approves. Approving either creates a template submission or starts a promotion send.
- **Logging:** an `AIGeneration` row stores the prompt version, model, input variables (which never include personal data), raw output, guardrail results, token usage, cost, the version the owner selected or edited, and the final approved text.

### A2 — Weekly insight narration (Could; not built, moved to R1.1)

- **Input:** a JSON object of numbers already computed for the week (bookings, revenue, return rate, busiest day, reminder conversion, change vs last week). It contains no customer-level data.
- **Output:** 3–5 sentences, plus `numbers_cited: number[]`.
- **Guardrail:** every number in the text must match a value in the input (allowing for formatting). If any doesn't, the narration is discarded and a fixed template is shown instead.

### Deferred

- Feedback summary (R1.1).
- Churn prediction (R3). This is a classic ML project with its own lifecycle: a definition of churn, ≥6 months of labelled data, a simple logistic-regression baseline, calibration, and drift monitoring.
- Chatbot booking and style recommendations (R3).

## 4. Data the model is allowed to see

| Allowed | Never allowed |
|---|---|
| Salon name, service names, promotion terms, aggregate numbers, tone/goal settings | Phone numbers, email, full names, birthdays, notes, payment references, feedback text with identifying details |

A1 drafts use **placeholders** for personal fields, so no customer data is ever sent. A1 and A2 both run on salon-level data only.

Provider settings: use the API tier that doesn't train on our data. Region and retention terms are recorded in [security-privacy.md](security-privacy.md).

## 5. Guardrails

Enforced in code (`src/domain/ai-guardrails.ts`, tested in `src/domain/permissions-guardrails.test.ts`). The prompt alone is never relied on.

| Check | Rule | On failure |
|---|---|---|
| Placeholders | Only `{{first_name}}`, `{{salon_name}}`, `{{barber_name}}`, `{{booking_link}}`, `{{offer}}`, `{{days_since_visit}}` are allowed | Drop the draft |
| No invented offers | No `%`, currency symbol, or the words "free", "discount" or "off" unless a promotion was supplied; if one was, any discount wording must be exactly `{{offer}}` (filled from the promotion record) | Drop the draft |
| Length | Within the per-goal limit (default 320 characters) and the WhatsApp variable limit | Drop the draft |
| Required content | Marketing drafts must include `{{booking_link}}` | Drop the draft |
| Opt-out hint | Marketing templates end with the fixed opt-out footer, which is added by code, never by AI | Code adds it |
| Content safety | Blocklist for profanity, discrimination, health or medical claims, and urgency or pressure tactics ("last chance!!!") | Drop the draft |
| Output schema | Response must parse against the JSON schema | Retry once, then show the manual editor |
| Budget | Monthly AI spend cap per salon (default USD 2) and per platform | Hide the AI button and offer manual entry |
| Timeout | 15 seconds | Fall back to manual entry |

## 6. Prompts and versioning

- Prompts live in [src/server/ai/prompts.ts](../src/server/ai/prompts.ts) with a version constant (`COPY_PROMPT_VERSION`, currently `copy-assistant.v2`). The system prompt explains the salon context and the rules. Variables are injected as structured data, never pasted into instructions.
- Every change to a prompt or model creates a new version and has to pass the eval suite in CI before merging.
- `AIGeneration.promptVersion` and `.model` make every output traceable.

## 6a. As built (2026-10-16)

- **Where:** `src/server/ai/` (interface, versioned prompt `copy-assistant.v2`, providers) and `src/server/staff/copy-assistant.ts` (budget check, guardrails, logging, saving wording, recording the outcome). Owners use it from **WhatsApp → Approve messages → Edit wording** and **WhatsApp → Send an offer**. Both screens show a "How AI suggestions work" notice ([model card](ai-model-card.md)).
- **Providers:** `AI_PROVIDER=fake` (default; no network) or `anthropic`. The Anthropic adapter uses the official SDK's structured output (`client.beta.messages.parse` with a zod schema), `effort: "low"` for this short task, a 15-second timeout, and **server-side refusal fallbacks** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). A refusal or error is logged and the owner is offered manual entry.
- **Default model:** `claude-opus-5-5`, overridable with `AI_MODEL`. This is a starting point; the final choice comes from the eval comparison in §7.
- **Placeholders:** the AI writes wording with named placeholders. `src/domain/template-builder.ts` turns them into Meta's numbered `{{1}}` format, and the opt-out footer is always added by code.
- **Logged per call** (`AIGeneration`): prompt version, provider, model, input (salon-level only), raw output, guardrail results per draft, tokens, cost, latency, **which draft the owner picked** (`selectedIndex`), the final text they saved or sent, and who approved it.

## 7. Model selection

Run the eval suite against the candidate models (see [ADR-0007](adr/0007-ai-provider.md)). Pick the **cheapest model that meets every threshold**, and re-run when providers release new models. Record the decision with eval scores in a new ADR.

## 8. Evaluation

See [evals/README.md](../evals/README.md). Summary of the thresholds:

| Metric | Threshold |
|---|---|
| Guardrail pass rate (share of drafts that pass every code check) | ≥ 95% |
| Invented offers reaching an owner | **0**, enforced by guardrails. Invented-offer drafts the model produces are tracked as a quality signal |
| Cases with no usable draft | 0 |
| Human rubric score (clarity, tone, fit with the salon's brand), sample of 30 | ≥ 4.0 / 5 |
| A2 number accuracy | 100% (enforced by the guardrail) |
| p95 latency | < 8 seconds |
| Cost per A1 request | < USD 0.01 |

**Business evaluation (online):** compare AI-assisted promotions with a promotion written without AI help, or with the fixed default template, and measure bookings within 7 days. It needs a holdout group: a random share of customers (`HOLDOUT_RATE`, default 10%) who get no win-back or offer messages, so their return rate shows what the messages really add.

## 9. Monitoring, drift and re-evaluation

**Built:** `pnpm ai:report [days]` ([scripts/ai-report.ts](../scripts/ai-report.ts), metrics in [src/domain/ai-quality.ts](../src/domain/ai-quality.ts)) reports, per prompt version and model: calls, errors, guardrail pass rate, share of calls with a usable draft, **adoption** (the wording was saved or sent), **kept word for word** (vs edited), top guardrail failures, cost and p95 latency. It exits with an error when a drift alert fires.

| Drift alert (with ≥ 20 calls) | Threshold | Same as |
|---|---|---|
| Guardrail pass rate | < 95% | eval gate |
| Error rate | > 5% | |
| Calls with a usable draft | < 90% | "no usable draft" eval metric |
| p95 latency | > 8 s | eval gate |

**Re-evaluation schedule**

| When | What |
|---|---|
| Every PR that changes the prompt, adapters, guardrails or eval cases | `ai-evals` CI job: `pnpm evals --gate` against the real model |
| Weekly | Run `pnpm ai:report 7`; any alert → re-run the evals and investigate |
| Monthly | Review 20 approved AI-assisted messages with the rubric ([evals/rubric.md](../evals/rubric.md)); add bad ones to `evals/cases/` tagged `regression` |
| When the provider releases or retires a model | Re-run the suite on the candidates and record the choice in an ADR (§7) |
| Quarterly | Compare bookings within 7 days for AI-assisted vs standard-template sends (using the holdout group) |

Still to add when there is traffic: opt-outs after AI-assisted promotions, and complaints.

## 10. Responsible AI notes

- Owners see the label "AI-suggested", and the final text is always their choice.
- Customers receive messages approved by the salon. We don't claim they were written by a person or by AI.
- Incident process: if an AI-assisted message causes harm (e.g. a wrong offer), the owner can pause the promotion. We investigate using the `AIGeneration` log and add a regression case to the eval set.
