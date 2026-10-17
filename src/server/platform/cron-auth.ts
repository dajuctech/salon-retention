import { timingSafeEqual } from "node:crypto";

/** Cron endpoints require "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends this). */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
