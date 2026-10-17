// `pnpm load:test`: HTTP load test against a running build (NFR-P2, NFR-S1). Not for production:
// point BASE_URL at staging or a local `pnpm build && pnpm start` with the demo seed.
//
//   BASE_URL=http://localhost:3100 pnpm load:test            # 20 users for 30 s
//   CONCURRENCY=50 DURATION=60 pnpm load:test
//
// Public pages run anonymously; staff pages sign in once as the demo owner (LOAD_EMAIL/LOAD_PASSWORD).

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION_S = Number(process.env.DURATION ?? 30);
const SLUG = process.env.LOAD_SLUG ?? "sharpandco";

type Target = { name: string; path: string; staff: boolean; p95BudgetMs: number };
const TARGETS: Target[] = [
  { name: "health", path: "/api/health", staff: false, p95BudgetMs: 200 },
  { name: "booking page (slots)", path: `/${SLUG}`, staff: false, p95BudgetMs: 800 },
  { name: "staff home", path: "/app", staff: true, p95BudgetMs: 500 },
  { name: "calendar day", path: "/app/calendar", staff: true, p95BudgetMs: 500 },
  { name: "calendar week", path: "/app/calendar?view=week", staff: true, p95BudgetMs: 1500 },
  { name: "customers", path: "/app/customers", staff: true, p95BudgetMs: 500 },
];

async function signIn(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: process.env.LOAD_EMAIL ?? "owner@sharpandco.test", password: process.env.LOAD_PASSWORD ?? "demo-password-123" }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Is the demo salon seeded?`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);

async function run(target: Target, cookie: string) {
  const times: number[] = [];
  let errors = 0;
  const until = Date.now() + DURATION_S * 1000;
  const worker = async () => {
    while (Date.now() < until) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}${target.path}`, { headers: target.staff ? { cookie } : {}, redirect: "manual" });
        await res.arrayBuffer(); // the whole streamed page, not just the first byte
        if (res.status !== 200) errors++;
      } catch {
        errors++;
      }
      times.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const sorted = [...times].sort((a, b) => a - b);
  return { name: target.name, requests: times.length, rps: times.length / DURATION_S, p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), errorRate: errors / Math.max(times.length, 1), budget: target.p95BudgetMs };
}

async function main() {
  console.log(`Load test: ${BASE}, ${CONCURRENCY} concurrent users, ${DURATION_S} s per target\n`);
  const cookie = await signIn();
  let failed = false;
  for (const t of TARGETS) {
    const r = await run(t, cookie);
    const ok = r.p95 <= r.budget && r.errorRate < 0.01;
    failed ||= !ok;
    console.log(
      `${ok ? "✓" : "✗"} ${r.name.padEnd(22)} ${String(r.requests).padStart(6)} req  ${r.rps.toFixed(1).padStart(6)}/s  p50 ${r.p50.toFixed(0).padStart(5)} ms  p95 ${r.p95.toFixed(0).padStart(5)} ms (budget ${r.budget})  p99 ${r.p99.toFixed(0).padStart(5)} ms  errors ${(r.errorRate * 100).toFixed(1)}%`,
    );
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
