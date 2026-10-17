// Every 5 minutes (vercel.json): send due messages (ADR-0004).
import { isCronAuthorized } from "@/server/platform/cron-auth";
import { dispatchDue } from "@/server/platform/dispatcher";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await dispatchDue({ limit: 200 }));
}
