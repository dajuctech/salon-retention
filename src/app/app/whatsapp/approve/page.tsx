// Approve messages — design p10 with the agreed changes (ai-design.md §2): template variants,
// "Why now" from code, Approve all with cost, no free-text per customer.
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { approvalQueue } from "@/server/staff/queries/whatsapp";
import { ApproveAll, DraftCard } from "./approve-client";
import { requirePage } from "@/server/auth/guards";

export const instant = false;

export default async function ApprovePage() {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requirePage("winback.approve");
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <Approve />
    </Suspense>
  );
}

async function Approve() {
  await connection();
  const s = await requireStaff();
  if (!can(s.member.role, "winback.approve")) notFound();
  const q = await approvalQueue(s);
  const n = q.drafts.length;

  return (
    <>
      <PageHeader title="Approve messages" subtitle={`${n} draft${n === 1 ? "" : "s"} waiting`} back={{ href: "/app/whatsapp", label: "WhatsApp" }} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        <p className="flex gap-3 rounded-2xl bg-accent-50 p-4 text-sm text-[#5a4210]">
          <Sparkles className="size-5 shrink-0" aria-hidden />
          These customers are past their usual gap. Messages use your approved WhatsApp templates. Nothing sends until you approve.{" "}
          <Link href="/app/whatsapp/templates" className="font-semibold underline">
            Edit wording
          </Link>
        </p>
        {n === 0 ? (
          <EmptyState action={<Link href="/app/customers?filter=due" className="font-semibold text-brand-900 underline">See customers due to return</Link>}>
            Nobody is waiting for approval. New drafts are made each morning for customers who are due back and agreed to offers.
          </EmptyState>
        ) : (
          <>
            {q.drafts.map((d) => (
              <DraftCard key={d.id} draft={d} total={n} hasOffer={Boolean(q.offer)} />
            ))}
            <ApproveAll count={n} costUsd={q.costUsd} />
          </>
        )}
      </div>
    </>
  );
}
