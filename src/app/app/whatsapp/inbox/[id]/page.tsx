// Inbox thread — UI_UX_DESIGN_PLAN §3.5, US-28, BR-R10.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { openConversation } from "@/server/staff/messaging";
import { conversationThread } from "@/server/staff/queries/whatsapp";
import { ThreadActions } from "./thread-client";
import { requireRecord } from "@/server/auth/guards";

export const instant = false;

export default async function ThreadPage({ params }: PageProps<"/app/whatsapp/inbox/[id]">) {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requireRecord("conversation", (await params).id);
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <Thread params={params} />
    </Suspense>
  );
}

async function Thread({ params }: { params: PageProps<"/app/whatsapp/inbox/[id]">["params"] }) {
  await connection();
  const s = await requireStaff();
  if (!can(s.member.role, "inbox.use")) notFound();
  const { id } = await params;
  const t = await conversationThread(s, id);
  if (!t) notFound();
  await openConversation(s, id);

  return (
    <>
      <PageHeader title={t.name ?? "Unknown number"} subtitle={t.phone} back={{ href: "/app/whatsapp?tab=inbox", label: "Inbox" }} />
      <div className="space-y-3 px-5 pt-5">
        {t.customerId && (
          <Link href={`/app/customers/${t.customerId}`} className="text-sm font-semibold text-brand-900 underline">
            Open customer
          </Link>
        )}
        <ol className="space-y-2" aria-label="Messages">
          {t.items.map((i) => (
            <li key={i.id} className={`flex ${i.from === "salon" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${i.from === "salon" ? "bg-brand-900 text-white" : "border border-border bg-card"}`}>
                <p className="whitespace-pre-line [overflow-wrap:anywhere]">{i.text}</p>
                <p className={`mt-1 text-xs ${i.from === "salon" ? "text-white/70" : "text-ink-muted"}`}>
                  {i.when}
                  {i.keyword ? ` · ${i.keyword === "START" ? "Opted back in" : "Opted out"} automatically` : ""}
                  {i.status === "FAILED" ? " · not delivered" : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <ThreadActions conversationId={t.id} hasCustomer={Boolean(t.customerId)} windowOpen={t.windowOpen} hoursLeft={t.windowHoursLeft} handled={t.handled} />
      </div>
    </>
  );
}
