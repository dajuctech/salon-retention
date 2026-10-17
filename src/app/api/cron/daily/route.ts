// Hourly (vercel.json): birthdays, win-back drafts, draft expiry, then data retention. All idempotent.
import { isCronAuthorized } from "@/server/platform/cron-auth";
import { runDailyJobs } from "@/server/platform/daily";
import { runRetention } from "@/server/platform/retention";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const daily = await runDailyJobs();
  return Response.json({ daily, retention: await runRetention() });
}
