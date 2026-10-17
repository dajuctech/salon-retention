// Uptime check (ADR-0009, docs/operations.md). Reports database connectivity only.
import { unscopedDb } from "@/server/db";

export async function GET() {
  try {
    await unscopedDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
