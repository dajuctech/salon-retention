// `pnpm ai:report [days]`: AI quality in production, per prompt version and model, from the
// AIGeneration log (ai-design.md §6). Run weekly; any alert means re-run the evals (evals/README.md).
import "dotenv/config";
import { qualityAlerts, summariseGenerations } from "../src/domain/ai-quality";
import { unscopedDb } from "../src/server/db";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

async function main() {
  const days = Number(process.argv[2] ?? 30);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await unscopedDb().aIGeneration.findMany({
    where: { feature: "copy_assistant", createdAt: { gte: since } },
    select: { promptVersion: true, model: true, rawOutput: true, guardrailResults: true, selectedIndex: true, finalText: true, costMicroUsd: true, latencyMs: true, error: true },
  });
  console.log(`AI copy assistant, last ${days} days: ${rows.length} calls\n`);
  let alerts = 0;
  for (const s of summariseGenerations(rows)) {
    console.log(`${s.promptVersion} · ${s.model}`);
    console.log(`  calls ${s.calls} (errors ${s.errors}) · guardrail pass ${pct(s.guardrailPassRate)} · usable ${pct(s.usableRate)}`);
    console.log(`  adopted ${pct(s.adoptionRate)} · kept word for word ${pct(s.keptAsIsRate)} · cost $${s.costUsd.toFixed(4)} · p95 ${s.p95LatencyMs ?? "n/a"} ms`);
    if (s.topViolations.length) console.log(`  top guardrail failures: ${s.topViolations.map((v) => `${v.violation} ×${v.count}`).join(", ")}`);
    for (const a of qualityAlerts(s)) {
      console.log(`  ⚠ ${a}`);
      alerts++;
    }
    console.log("");
  }
  if (alerts) process.exitCode = 1;
}

main().finally(() => unscopedDb().$disconnect());
