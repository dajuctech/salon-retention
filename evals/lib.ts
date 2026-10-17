// Offline eval harness for the AI copy assistant (docs/ai-design.md §8, evals/README.md).
import { checkDraft, type Violation } from "../src/domain/ai-guardrails";

export type EvalCase = {
  id: string;
  goal: "winback" | "birthday" | "promotion" | "reactivation" | "thank_you";
  tone: "friendly" | "professional" | "playful";
  maxLength: number;
  promotion: { kind: string; value: number; services: string[]; endsOn: string } | null;
  ownerBrief?: string;
  language?: string;
  salonName?: string;
  tags: string[];
};

export type Generation = { drafts: string[]; latencyMs: number; costMicroUsd: number };
export type Generator = (c: EvalCase) => Promise<Generation>;

export type DraftResult = { caseId: string; draft: string; violations: Violation[] };

export type EvalReport = {
  cases: number;
  drafts: number;
  guardrailPassRate: number;
  /** Drafts that mentioned an offer when none was supplied: a model-quality signal (guardrails block them). */
  inventedOfferDrafts: number;
  casesWithoutUsableDraft: string[];
  p95LatencyMs: number;
  avgCostMicroUsd: number;
  failures: DraftResult[];
};

export const THRESHOLDS = {
  guardrailPassRate: 0.95,
  maxCasesWithoutUsableDraft: 0,
  p95LatencyMs: 8000,
  maxAvgCostMicroUsd: 10_000, // USD 0.01 per request
} as const;

// Promotion messages get the booking link from their template (promotion_generic_v1).
const REQUIRES_LINK = new Set(["winback", "birthday", "reactivation"]);

export function parseCases(jsonl: string): EvalCase[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalCase);
}

export async function runEval(cases: readonly EvalCase[], generate: Generator): Promise<EvalReport> {
  const results: DraftResult[] = [];
  const latencies: number[] = [];
  let cost = 0;
  const withoutUsable: string[] = [];

  for (const c of cases) {
    const g = await generate(c);
    latencies.push(g.latencyMs);
    cost += g.costMicroUsd;
    const rules = {
      maxLength: c.maxLength,
      promotionProvided: c.promotion !== null,
      requireBookingLink: REQUIRES_LINK.has(c.goal),
    };
    const caseResults = g.drafts.map((draft) => ({ caseId: c.id, draft, violations: checkDraft(draft, rules).violations }));
    if (!caseResults.some((r) => r.violations.length === 0)) withoutUsable.push(c.id);
    results.push(...caseResults);
  }

  const passed = results.filter((r) => r.violations.length === 0).length;
  const promoless = new Set(cases.filter((c) => c.promotion === null).map((c) => c.id));
  return {
    cases: cases.length,
    drafts: results.length,
    guardrailPassRate: results.length ? passed / results.length : 0,
    inventedOfferDrafts: results.filter(
      (r) => promoless.has(r.caseId) && r.violations.some((v) => v === "literal_offer" || v === "offer_without_promotion"),
    ).length,
    casesWithoutUsableDraft: withoutUsable,
    p95LatencyMs: percentile(latencies, 0.95),
    avgCostMicroUsd: cases.length ? Math.round(cost / cases.length) : 0,
    failures: results.filter((r) => r.violations.length > 0),
  };
}

export function gate(r: EvalReport): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.guardrailPassRate < THRESHOLDS.guardrailPassRate) {
    reasons.push(`guardrail pass rate ${(r.guardrailPassRate * 100).toFixed(1)}% < ${THRESHOLDS.guardrailPassRate * 100}%`);
  }
  if (r.casesWithoutUsableDraft.length > THRESHOLDS.maxCasesWithoutUsableDraft) {
    reasons.push(`no usable draft for: ${r.casesWithoutUsableDraft.join(", ")}`);
  }
  if (r.p95LatencyMs > THRESHOLDS.p95LatencyMs) reasons.push(`p95 latency ${r.p95LatencyMs}ms > ${THRESHOLDS.p95LatencyMs}ms`);
  if (r.avgCostMicroUsd > THRESHOLDS.maxAvgCostMicroUsd) {
    reasons.push(`avg cost $${(r.avgCostMicroUsd / 1e6).toFixed(4)} > $${THRESHOLDS.maxAvgCostMicroUsd / 1e6}`);
  }
  return { pass: reasons.length === 0, reasons };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
