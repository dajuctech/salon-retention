// Audit log for sensitive actions (US-26). Written in the same transaction as the change.
import type { Prisma } from "@/generated/prisma/client";
import type { TenantDb } from "./db";

export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
export type DbLike = TenantDb | TenantTx;

export type AuditEntry = {
  salonId: string;
  actorId: string | null;
  actorType: "staff" | "customer" | "system";
  action: string; // e.g. booking.status_changed
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

export async function audit(db: DbLike, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: entry });
}
