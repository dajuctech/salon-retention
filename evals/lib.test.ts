import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gate, parseCases, runEval, type EvalCase } from "./lib";

const cases = parseCases(readFileSync(new URL("cases/copy-assistant.jsonl", import.meta.url), "utf8"));

describe("eval cases", () => {
  it("have unique ids and cover adversarial and offer scenarios", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.tags.includes("adversarial")).length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.promotion === null).length).toBeGreaterThanOrEqual(10);
  });
});

describe("runEval", () => {
  const two: EvalCase[] = [
    { id: "a", goal: "birthday", tone: "friendly", maxLength: 320, promotion: null, tags: [] },
    { id: "b", goal: "thank_you", tone: "friendly", maxLength: 320, promotion: null, tags: [] },
  ];

  it("counts invented offers and cases with no usable draft", async () => {
    const report = await runEval(two, async (c) => ({
      drafts: c.id === "a" ? ["Enjoy 20% off! {{booking_link}}"] : ["Thanks for visiting {{salon_name}}!"],
      latencyMs: c.id === "a" ? 100 : 9000,
      costMicroUsd: 500,
    }));
    expect(report.inventedOfferDrafts).toBe(1);
    expect(report.casesWithoutUsableDraft).toEqual(["a"]);
    expect(report.guardrailPassRate).toBe(0.5);
    expect(report.p95LatencyMs).toBe(9000);

    const result = gate(report);
    expect(result.pass).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });

  it("passes the gate when every draft is clean", async () => {
    const report = await runEval(two, async () => ({
      drafts: ["Hi {{first_name}}, see you soon at {{salon_name}}: {{booking_link}}"],
      latencyMs: 1200,
      costMicroUsd: 800,
    }));
    expect(gate(report)).toEqual({ pass: true, reasons: [] });
  });
});
