import { describe, expect, it } from "vitest";
import { qualityAlerts, summariseGenerations, type GenerationRow } from "./ai-quality";

const row = (o: Partial<GenerationRow>): GenerationRow => ({
  promptVersion: "copy-assistant.v2",
  model: "claude-opus-5-5",
  rawOutput: ["A {{booking_link}}", "B {{booking_link}}", "LAST CHANCE"],
  guardrailResults: [[], [], ["blocked_term:last chance"]],
  selectedIndex: null,
  finalText: null,
  costMicroUsd: 1000,
  latencyMs: 2000,
  error: null,
  ...o,
});

describe("AI feedback loop metrics (ai-design.md §6)", () => {
  it("computes pass, usable, adoption and kept-as-is rates per prompt and model", () => {
    const [s] = summariseGenerations([
      row({ selectedIndex: 0, finalText: "A {{booking_link}}" }), // picked and kept
      row({ selectedIndex: 1, finalText: "B, edited {{booking_link}}" }), // picked then edited
      row({}), // shown, not used
      row({ error: "timeout", rawOutput: null, guardrailResults: null, latencyMs: 15000 }),
    ]);
    expect(s).toMatchObject({ calls: 4, errors: 1, adoptionRate: 2 / 3, keptAsIsRate: 0.5, usableRate: 1 });
    expect(s.guardrailPassRate).toBeCloseTo(6 / 9);
    expect(s.topViolations).toEqual([{ violation: "blocked_term", count: 3 }]);
    expect(s.costUsd).toBeCloseTo(0.004);
    expect(s.p95LatencyMs).toBe(15000);
  });

  it("keeps prompt versions and models apart, newest prompt first", () => {
    const out = summariseGenerations([row({ promptVersion: "copy-assistant.v1" }), row({}), row({ model: "claude-haiku-5-5" })]);
    expect(out.map((s) => `${s.promptVersion}/${s.model}`)).toEqual(["copy-assistant.v2/claude-haiku-5-5", "copy-assistant.v2/claude-opus-5-5", "copy-assistant.v1/claude-opus-5-5"]);
  });

  it("returns nulls rather than fake zeros when there is nothing to measure", () => {
    const [s] = summariseGenerations([row({ error: "refused", rawOutput: null, guardrailResults: null, latencyMs: null })]);
    expect(s).toMatchObject({ guardrailPassRate: null, usableRate: null, adoptionRate: null, keptAsIsRate: null, p95LatencyMs: null });
  });

  it("raises drift alerts only with enough calls", () => {
    const [s] = summariseGenerations(Array.from({ length: 25 }, () => row({})));
    expect(qualityAlerts(s)).toEqual(["guardrail pass rate 66.7% < 95%"]);
    expect(qualityAlerts({ ...s, calls: 5 })).toEqual([]);
    expect(qualityAlerts({ ...s, guardrailPassRate: 0.99, errors: 3, usableRate: 0.5, p95LatencyMs: 12_000 })).toEqual([
      "error rate 12.0% > 5%",
      "only 50% of calls had a usable draft",
      "p95 latency 12000 ms > 8 s",
    ]);
  });
});
