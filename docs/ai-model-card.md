# Model card: AI copy assistant

A short, honest description of the one AI feature, for owners, reviewers and the team. Format based on "Model Cards for Model Reporting" (Mitchell et al., 2019). Technical design: [ai-design.md](ai-design.md).

| | |
|---|---|
| Feature | Copy assistant (US-30, ai-design.md §3 A1) |
| What it does | Suggests up to 3 versions of the **wording** for a win-back message or an offer campaign |
| Model | Anthropic Claude via the official SDK; default `claude-opus-5-5`, set with `AI_MODEL`. Final choice: the cheapest model that passes the evals (ADR-0007) |
| Prompt version | `copy-assistant.v2` ([src/server/ai/prompts.ts](../src/server/ai/prompts.ts)) |
| Status | Built and tested with a stand-in generator. **Not yet evaluated on the real model** (needs an API key and approval to spend) |

## Intended use

- **Users:** salon owners only (permission `ai.copyAssistant`).
- **Use:** a starting point for wording that the owner reads, edits and approves. The owner, not the AI, decides who gets a message, when, and which offer applies. Those are fixed software rules ([business-rules.md](business-rules.md)).
- **Out of scope:** sending anything by itself, choosing customers, inventing offers or prices, replying to customers, any decision about a person.

## Inputs and data

- **Sent to the model:** salon name, the goal (e.g. win-back), tone, length limit, the running offer's description if any, and the owner's optional note (max 300 characters).
- **Never sent:** customer names, phone numbers, visit history or any other personal data. Customer details are filled into placeholders like `{{first_name}}` later, by code, when each message is sent.
- **Stored:** every call is logged in `AIGeneration` (input, outputs, guardrail results, cost, which draft was picked, the final text) for 12 months, then deleted by the retention job.

## Safety measures

1. **Guardrails in code** ([src/domain/ai-guardrails.ts](../src/domain/ai-guardrails.ts)) check every draft before the owner sees it: only allowed placeholders, no offer wording unless an offer was supplied, no pressure words or health claims, a booking link where needed, and a length limit. Drafts that fail are hidden.
2. **Human approval:** nothing is sent until the owner approves. Marketing messages also respect consent, quiet hours and the weekly limit.
3. **Budget:** a monthly AI spending cap per salon (default USD 2). When it's used up, the owner writes the wording themselves.
4. **Failure fallback:** if the model refuses, errors or times out (15 s), the owner is told and can write the wording by hand.

## Evaluation

| Check | Target | Result |
|---|---|---|
| Guardrail pass rate | ≥ 95% | **Not yet measured on the real model** |
| Cases with no usable draft | 0 | Not yet measured |
| p95 latency | < 8 s | Not yet measured |
| Cost per request | < USD 0.01 | Not yet measured |
| Human rubric (30 drafts) | ≥ 4.0 / 5 | Not yet done |
| Guardrails catch adversarial drafts (offline) | All caught | ✅ Passing (`pnpm evals`) |

Test cases: [evals/cases/copy-assistant.jsonl](../evals/cases/copy-assistant.jsonl), including attempts to get the model to invent discounts, add phone numbers, use urgency or follow injected instructions.

## Known limitations

- English only in R1.
- Tone may not match a particular salon's voice; owners should read every draft.
- Placeholders and offers are protected by code, but the model can still produce wording that is accurate yet awkward. The rubric review exists for this.
- Quality may change when the provider updates a model. Monitoring and the re-evaluation schedule in [ai-design.md §9](ai-design.md#9-monitoring-drift-and-re-evaluation) are there to catch it.

## Monitoring

`pnpm ai:report` (weekly) shows pass rate, adoption, how often owners keep a draft word for word, cost and latency per prompt and model, with drift alerts. See [ai-design.md §9](ai-design.md#9-monitoring-drift-and-re-evaluation).

## Owner-facing notice

Shown on both screens that offer suggestions ("How AI suggestions work"): suggestions only, no customer data sent, rule-checked, can be wrong, uses a little of the AI budget.
