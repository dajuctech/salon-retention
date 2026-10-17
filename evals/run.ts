// Usage: pnpm evals [--gate]
//   AI_PROVIDER=fake  → checks the harness itself against fixtures (default; doesn't gate)
//   AI_PROVIDER=anthropic → the production adapter and prompt (costs money; needs ANTHROPIC_API_KEY
//                          or an `ant auth login` profile); --gate fails the run if thresholds are missed
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getGenerator } from "../src/server/ai/providers";
import { gate, parseCases, runEval, type EvalCase, type Generator } from "./lib";

const here = new URL(".", import.meta.url);
const cases = parseCases(readFileSync(new URL("cases/copy-assistant.jsonl", here), "utf8"));

function fakeGenerator(): Generator {
  const fixtures = JSON.parse(readFileSync(new URL("fixtures/fake-outputs.json", here), "utf8")) as Record<
    string,
    string[]
  >;
  return async (c: EvalCase) => ({
    drafts: fixtures[c.id] ?? [
      c.promotion
        ? c.goal === "promotion"
          ? "Hi {{first_name}}, {{salon_name}} has an offer for you: {{offer}}"
          : "Hi {{first_name}}, {{salon_name}} has an offer for you: {{offer}} Book: {{booking_link}}"
        : "Hi {{first_name}}, it's {{salon_name}}. Ready for your next cut? Book: {{booking_link}}",
    ],
    latencyMs: 0,
    costMicroUsd: 0,
  });
}

/** The same generator and prompt the app uses, timed and costed per case. */
function realGenerator(): Generator {
  const generator = getGenerator();
  return async (c: EvalCase) => {
    const started = Date.now();
    const g = await generator.draft({
      goal: c.goal,
      tone: c.tone,
      maxLength: c.maxLength,
      salonName: c.salonName ?? "Sharp & Co.",
      promotion: c.promotion ? { description: `${c.promotion.kind} ${c.promotion.value} on ${c.promotion.services.join(", ")} until ${c.promotion.endsOn}` } : null,
      ownerBrief: c.ownerBrief,
      language: c.language,
    });
    return { drafts: g.drafts, latencyMs: Date.now() - started, costMicroUsd: g.costMicroUsd };
  };
}

async function main() {
  const provider = process.env.AI_PROVIDER ?? "fake";
  const report = await runEval(cases, provider === "fake" ? fakeGenerator() : realGenerator());
  const { failures, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
  for (const f of failures) console.log(`✗ ${f.caseId}: ${f.violations.join(", ")}\n  ${f.draft}`);

  const result = gate(report);
  const label = provider === "fake" ? " (fake provider: fixtures only, not enforced)" : "";
  console.log(result.pass ? `\nGate: PASS${label}` : `\nGate: FAIL${label}\n- ${result.reasons.join("\n- ")}`);
  if (process.argv.includes("--gate") && !result.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
