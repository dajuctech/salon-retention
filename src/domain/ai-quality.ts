// AI quality metrics from the AIGeneration log (ai-design.md §6, the AI feedback loop). Pure, so
// the same numbers come from `pnpm ai:report` and from tests.

export type GenerationRow = {
  promptVersion: string;
  model: string;
  rawOutput: unknown;
  guardrailResults: unknown; // string[][]: violations per draft ([] = passed)
  selectedIndex: number | null;
  finalText: string | null;
  costMicroUsd: number | null;
  latencyMs: number | null;
  error: string | null;
};

export type QualitySummary = {
  promptVersion: string;
  model: string;
  calls: number;
  errors: number;
  /** Share of all drafts that passed the guardrails. Target ≥ 95% (evals/rubric.md). */
  guardrailPassRate: number | null;
  /** Calls where at least one draft could be shown. */
  usableRate: number | null;
  /** Calls whose wording the owner went on to save or send. */
  adoptionRate: number | null;
  /** Of the adopted ones: picked a draft and kept it word for word. */
  keptAsIsRate: number | null;
  topViolations: { violation: string; count: number }[];
  costUsd: number;
  p95LatencyMs: number | null;
};

const ratio = (n: number, d: number) => (d === 0 ? null : n / d);

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function violationsOf(row: GenerationRow): string[][] {
  return Array.isArray(row.guardrailResults) ? (row.guardrailResults as unknown[]).map((v) => (Array.isArray(v) ? v.map(String) : [])) : [];
}

/** One summary per prompt version and model, newest prompt first. */
export function summariseGenerations(rows: GenerationRow[]): QualitySummary[] {
  const groups = new Map<string, GenerationRow[]>();
  for (const r of rows) {
    const k = `${r.promptVersion}\u0000${r.model}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()]
    .map((g) => {
      const ok = g.filter((r) => !r.error);
      const perDraft = ok.flatMap(violationsOf);
      const usable = ok.filter((r) => violationsOf(r).some((v) => v.length === 0));
      const adopted = ok.filter((r) => r.finalText !== null);
      const keptAsIs = adopted.filter((r) => {
        const raw = Array.isArray(r.rawOutput) ? (r.rawOutput as unknown[]) : [];
        return r.selectedIndex !== null && raw[r.selectedIndex] === r.finalText;
      });
      const counts = new Map<string, number>();
      for (const v of perDraft.flat()) {
        const key = v.split(":")[0];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return {
        promptVersion: g[0].promptVersion,
        model: g[0].model,
        calls: g.length,
        errors: g.length - ok.length,
        guardrailPassRate: ratio(perDraft.filter((v) => v.length === 0).length, perDraft.length),
        usableRate: ratio(usable.length, ok.length),
        adoptionRate: ratio(adopted.length, ok.length),
        keptAsIsRate: ratio(keptAsIs.length, adopted.length),
        topViolations: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([violation, count]) => ({ violation, count })),
        costUsd: g.reduce((s, r) => s + (r.costMicroUsd ?? 0), 0) / 1_000_000,
        p95LatencyMs: percentile(g.map((r) => r.latencyMs).filter((x): x is number => x !== null), 95),
      };
    })
    .sort((a, b) => b.promptVersion.localeCompare(a.promptVersion) || a.model.localeCompare(b.model));
}

/** Warnings when production drifts below the eval targets (re-evaluation triggers, ai-design.md §6). */
export function qualityAlerts(s: QualitySummary, minCalls = 20): string[] {
  if (s.calls < minCalls) return [];
  const alerts: string[] = [];
  if (s.guardrailPassRate !== null && s.guardrailPassRate < 0.95) alerts.push(`guardrail pass rate ${(s.guardrailPassRate * 100).toFixed(1)}% < 95%`);
  if (s.errors / s.calls > 0.05) alerts.push(`error rate ${((s.errors / s.calls) * 100).toFixed(1)}% > 5%`);
  if (s.usableRate !== null && s.usableRate < 0.9) alerts.push(`only ${(s.usableRate * 100).toFixed(0)}% of calls had a usable draft`);
  if (s.p95LatencyMs !== null && s.p95LatencyMs > 8_000) alerts.push(`p95 latency ${s.p95LatencyMs} ms > 8 s`);
  return alerts;
}
