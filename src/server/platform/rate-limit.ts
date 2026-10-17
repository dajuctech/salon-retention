// Rate limiting for public endpoints (US-10 AC4, security-privacy.md). Fixed-window counters kept
// in Postgres so the limit holds across serverless instances. Per-IP limits are applied by the
// hosting platform's firewall (ADR-0009); here we limit per phone number and per action key.
import { unscopedDb } from "@/server/db";

/** True if this key is still under `max` requests in the current window of `windowSec` seconds. */
export async function allowPublicRequest(key: string, max: number, windowSec: number): Promise<boolean> {
  // The window's start time in seconds, so stale counters can be cleaned up by age (retention.ts).
  const window = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const rows = await unscopedDb().$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitHit" ("key", "window", "count") VALUES (${key}, ${window}, 1)
    ON CONFLICT ("key", "window") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
    RETURNING "count"`;
  return (rows[0]?.count ?? 0) <= max;
}
