// In-page guards: a forbidden or missing staff page renders not-found. The proxy (src/proxy.ts)
// checks the same rules first so production answers with a real 404 status before streaming.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Capability, Role } from "@/domain/permissions";
import { hasAnyCapability, recordVisible, type RecordKind } from "./page-access";
import { requireStaff, type StaffContext } from "./session";

/** Signed-in staff who hold `capability` (or any of several); otherwise 404. */
export async function requirePage(...capabilities: Capability[]): Promise<StaffContext> {
  await connection();
  const s = await requireStaff();
  if (!hasAnyCapability(s.member, capabilities)) notFound();
  return s;
}

/** For pages about one record: 404 unless it exists in this salon and the member may see it. */
export async function requireRecord(kind: RecordKind, id: string): Promise<StaffContext> {
  const s = await requirePage();
  if (!(await recordVisible(s.member, kind, id))) notFound();
  return s;
}

/** For pages open to some roles only; otherwise 404. */
export async function requireRole(...roles: Role[]): Promise<StaffContext> {
  const s = await requirePage();
  if (!roles.includes(s.member.role)) notFound();
  return s;
}
