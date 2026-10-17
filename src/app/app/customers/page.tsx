// Customers — design p6.
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar, Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { SEGMENT_FILTERS, customersList, type SegmentFilter } from "@/server/staff/queries/customers";

export const instant = false;

export default function CustomersPage({ searchParams }: PageProps<"/app/customers">) {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: { searchParams: PageProps<"/app/customers">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const filter = (SEGMENT_FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all") as SegmentFilter;
  const limit = Math.min(500, Number(sp.limit) || 50);
  const data = await customersList(s, q, filter, limit);
  const href = (patch: Record<string, string>) => `/app/customers?${new URLSearchParams({ q, filter, ...patch })}`;

  return (
    <>
      <PageHeader title="Customers" subtitle={`${data.total} in your book`} userName={s.user.name} />
      <div className="px-5 pt-4">
        {sp.deleted && <p role="status" className="mb-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">Customer&apos;s personal data deleted.</p>}
        <div className="flex gap-3">
          <form className="relative flex-1" role="search" action="/app/customers">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input type="hidden" name="filter" value={filter} />
            <input
              name="q"
              defaultValue={q}
              aria-label={can(s.member.role, "customers.viewPhone") ? "Search name or phone" : "Search name"}
              placeholder={can(s.member.role, "customers.viewPhone") ? "Search name or phone" : "Search name"}
              className="w-full rounded-2xl border border-border bg-card py-3 pl-12 pr-4 outline-none focus:border-brand-900"
            />
          </form>
          {can(s.member.role, "customers.edit") && (
            <Link href="/app/customers/new" aria-label="Add customer" className="flex size-12 items-center justify-center rounded-2xl bg-accent-500 text-brand-900">
              <Plus className="size-6" aria-hidden />
            </Link>
          )}
        </div>
        <nav aria-label="Filter customers" className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          {SEGMENT_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href({ filter: f.key })}
              aria-current={filter === f.key ? "true" : undefined}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${filter === f.key ? "bg-brand-900 text-white" : "border border-border bg-card"}`}
            >
              {f.label} {data.counts[f.key]}
            </Link>
          ))}
        </nav>

        <div className="mt-3">
          {data.rows.length === 0 ? (
            <EmptyState action={!q && filter === "all" ? <Link href="/app/walk-in" className="font-semibold text-brand-900 underline">Add your first walk-in</Link> : undefined}>
              {q ? `No customers match "${q}".` : filter === "all" ? "No customers yet." : "Nobody in this group right now."}
            </EmptyState>
          ) : (
            <Card className="divide-y divide-border">
              {data.rows.map((c) => (
                <Link key={c.id} href={`/app/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-sm text-ink-muted">{c.line}</span>
                  </span>
                  <Badge tone={c.badge.tone}>{c.badge.label}</Badge>
                </Link>
              ))}
            </Card>
          )}
          <p className="mt-3 text-center text-sm text-ink-muted">
            Showing {data.shown} of {data.filteredTotal}
            {data.more && (
              <>
                {" · "}
                <Link href={href({ limit: String(limit + 50) })} className="font-semibold text-brand-900 underline">
                  Show more
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}
