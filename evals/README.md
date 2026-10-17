# AI Evaluation

Covers the AI copy assistant (A1). The insight narration eval (A2) is added when that feature is built. Design: [docs/ai-design.md](../docs/ai-design.md).

## What's here

| Path | Purpose |
|---|---|
| `cases/copy-assistant.jsonl` | Test cases: goals × tones × with/without a promotion × length limits, plus **adversarial owner briefs** (asks for a discount with no promotion, prompt injection, urgency, health claims, opt-out text) |
| `lib.ts` | Harness: runs a generator over the cases, applies the **production guardrails** (`src/domain/ai-guardrails.ts`), computes metrics, and checks thresholds |
| `run.ts` | CLI (`pnpm evals`, `pnpm evals --gate`) |
| `fixtures/fake-outputs.json` | Fixed outputs for `AI_PROVIDER=fake`, used to test the harness. These are **not** model results |
| `rubric.md` | Rubric for human grading |

## Automated metrics and thresholds

| Metric | Threshold | Why |
|---|---|---|
| Guardrail pass rate (share of drafts that pass every check) | ≥ 95% | Owners should rarely see "no suggestions" |
| Cases with no usable draft | 0 | Every request must return at least one usable option |
| Invented-offer drafts (offer wording with no promotion supplied) | Tracked; aim for 0 | Guardrails block these from reaching owners, but a high count means the prompt or model is unreliable |
| p95 latency | < 8 s | Keeps the UI responsive |
| Average cost per request | < USD 0.01 | One call per template or promotion, so cost should be tiny |

## Human rubric (sample of 30 drafts per prompt or model change)

See [rubric.md](rubric.md). Pass: average ≥ 4.0/5, and no draft scores 1 on *Accuracy* or *Respect*.

## Process

1. Every change to a prompt, model or guardrail runs `pnpm evals --gate` against the real provider in CI. The job only runs on PRs that touch `src/server/ai/**` or `evals/**`, because it costs money.
2. Model selection: run the suite on each candidate (ADR-0007) and pick the cheapest model that passes. Record the scores in a new ADR.
3. **Regression cases:** every bad output found in production (through the monthly review or an incident) is added to `cases/` with the tag `regression`.
4. Grow the case set to 50–100 cases using real owner briefs from the pilot, with personal data removed.

## Online evaluation (after launch)

How often drafts are selected, how much owners edit them, opt-outs after AI-assisted sends, and bookings within 7 days compared with fixed-template sends. Comparisons use a holdout group: a random share of customers (`HOLDOUT_RATE`, default 10%) who get no win-back or offer messages, so their return rate shows what the messages really add.
