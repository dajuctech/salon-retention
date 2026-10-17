// Database access (ADR-0002). Tenant data must go through forSalon(); the unscoped
// client is for auth, platform jobs and health checks only (lint-enforced).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function unscopedDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForPrisma.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return globalForPrisma.prisma;
}

/** Models that carry a non-null salonId. */
const TENANT_MODELS = new Set([
  "OpeningHours",
  "ClosedDate",
  "Service",
  "Barber",
  "BarberHours",
  "TimeOff",
  "Customer",
  "Consent",
  "Booking",
  "Payment",
  "LoyaltyRedemption",
  "Message",
  "Conversation",
  "InboundMessage",
  "Promotion",
  "AIGeneration",
  "AuditLog",
]);

/** salonId null = platform-wide row, readable by every salon but writable by none. */
const SHARED_MODELS = new Set(["MessageTemplate"]);

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

type Args = Record<string, unknown> & { where?: object; data?: unknown; create?: object; update?: object };

function withoutSalonId(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { salonId, ...rest } = data as Record<string, unknown>;
  return rest;
}

export function scopeArgs(operation: string, input: unknown, salonId: string, shared: boolean): Args {
  const args = { ...((input ?? {}) as Args) };
  const ownRows = { salonId };
  const readable = shared ? { OR: [{ salonId }, { salonId: null }] } : ownRows;

  if (CREATE_OPS.has(operation)) {
    args.data = Array.isArray(args.data)
      ? args.data.map((d) => ({ ...(d as object), salonId }))
      : { ...(args.data as object), salonId };
  } else if (operation === "upsert") {
    args.where = { ...args.where, ...ownRows };
    args.create = { ...args.create, salonId };
    args.update = withoutSalonId(args.update) as object;
  } else if (UPDATE_OPS.has(operation)) {
    // Writes only touch this salon's rows and can never move a row to another salon.
    args.where = { ...args.where, ...ownRows };
    args.data = withoutSalonId(args.data);
  } else if (operation === "delete" || operation === "deleteMany") {
    args.where = { ...args.where, ...ownRows };
  } else if (READ_OPS.has(operation)) {
    if (shared) {
      // Keep any AND the caller already has; never replace it.
      const where = (args.where ?? {}) as { AND?: unknown };
      const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
      args.where = { ...where, AND: [...existing, readable] };
    } else {
      args.where = { ...args.where, ...ownRows };
    }
  } else {
    throw new Error(`forSalon: unsupported operation ${operation}`);
  }
  return args;
}

/**
 * A Prisma client that only sees and writes rows for one salon.
 * salonId must come from the authenticated session or a verified public slug, never the request body.
 *
 * Limits (ADR-0002): nested writes are not scoped, so create related tenant rows with separate
 * calls; IDs received from clients must be loaded through forSalon() before being used as
 * foreign keys. Postgres RLS (R2) will back this up at the database level.
 */
export function forSalon(salonId: string) {
  if (!salonId) throw new Error("forSalon: salonId is required");
  return unscopedDb().$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const shared = SHARED_MODELS.has(model);
          if (!shared && !TENANT_MODELS.has(model)) return query(args);
          return query(scopeArgs(operation, args, salonId, shared) as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forSalon>;

/** Resolves a public booking slug to its salon; the result's id is then used with forSalon(). */
export async function findSalonBySlug(slug: string) {
  return unscopedDb().salon.findUnique({ where: { slug } });
}

export type PublicSalon = NonNullable<Awaited<ReturnType<typeof findSalonBySlug>>>;
