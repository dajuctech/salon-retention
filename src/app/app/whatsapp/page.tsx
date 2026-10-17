// WhatsApp hub — design p9 (+ Inbox tab, US-28).
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, EmptyState, MESSAGE_BADGE, PageHeader, Skeleton } from "@/components/ui";
import { requireStaff } from "@/server/auth/session";
import { whatsappHub, type HubTab } from "@/server/staff/queries/whatsapp";
import { AutoToggles, DevTools, FailureActions, PauseSending } from "./whatsapp-client";
import { requirePage } from "@/server/auth/guards";

export const instant = false;

const TABS: { key: HubTab; label: string }[] = [
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent today" },
  { key: "failed", label: "Failed" },
  { key: "inbox", label: "Inbox" },
];

export default async function WhatsAppPage({ searchParams }: PageProps<"/app/whatsapp">) {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requirePage("messages.viewLog");
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <WhatsApp searchParams={searchParams} />
    </Suspense>
  );
}

async function WhatsApp({ searchParams }: { searchParams: PageProps<"/app/whatsapp">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  if (s.member.role === "barber") notFound();
  const sp = await searchParams;
  const tab = (TABS.some((t) => t.key === sp.tab) ? sp.tab : "scheduled") as HubTab;
  const d = await whatsappHub(s, tab);
  const count = (k: HubTab) => (k === "scheduled" ? d.counts.scheduled : k === "sent" ? d.counts.sent : k === "failed" ? d.counts.failed : d.counts.unread);
  const showDevTools = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_TOOLS === "true";

  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Reminders and customer messages" userName={s.user.name} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        {typeof sp.approved === "string" && (
          <p role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            Messages {sp.approved}
          </p>
        )}
        <Card className="flex items-center gap-3 p-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-900" aria-hidden>
            <MessageCircle className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-bold">{d.provider === "console" ? "Test mode" : "Connected"}</span>
            <span className="block text-sm text-ink-muted">
              {d.provider === "console" ? "Messages are logged, not sent" : (d.number ?? "Shared salon number")} · {d.sentToday} sent today
            </span>
          </span>
          <Badge tone={d.provider === "console" ? "amber" : "green"}>{d.provider === "console" ? "Test" : "Live"}</Badge>
        </Card>

        <PauseSending paused={d.paused} platformWide={d.pausedPlatformWide} canEdit={d.canEditSettings} />

        <section>
          <h2 className="mb-2 text-xl font-bold">Automatic messages</h2>
          <AutoToggles settings={d.settings} disabled={!d.canEditSettings} />
        </section>

        {d.drafts > 0 && (
          <div className="flex items-center gap-3 rounded-2xl bg-accent-50 p-4">
            <span className="flex-1">
              <span className="block font-bold text-[#5a4210]">
                {d.drafts} draft{d.drafts === 1 ? "" : "s"} need{d.drafts === 1 ? "s" : ""} your approval
              </span>
              <span className="block text-sm text-[#5a4210]">Nothing sends until you approve it.</span>
            </span>
            <Link href="/app/whatsapp/approve" className="rounded-xl bg-brand-900 px-4 py-3 font-semibold text-white">
              Review
            </Link>
          </div>
        )}
        {s.member.role === "owner" && (
          <Link href="/app/whatsapp/offers" className="flex w-full items-center justify-center rounded-2xl border border-brand-900 bg-card py-3 font-semibold text-brand-900">
            Send an offer to customers
          </Link>
        )}

        <nav aria-label="Message lists" className="grid grid-cols-4 gap-1 rounded-2xl bg-status-done p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/app/whatsapp?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`rounded-xl py-2 text-center text-sm font-semibold ${tab === t.key ? "bg-card shadow-sm" : "text-ink-muted"}`}
            >
              {t.label} {count(t.key) || ""}
            </Link>
          ))}
        </nav>

        {tab === "inbox" ? (
          d.conversations.length === 0 ? (
            <EmptyState>No customer replies yet.</EmptyState>
          ) : (
            <Card className="divide-y divide-border">
              {d.conversations.map((c) => (
                <Link key={c.id} href={`/app/whatsapp/inbox/${c.id}`} className="flex items-start gap-3 px-4 py-3">
                  {c.unread > 0 && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-status-danger-ink" aria-label="Unread" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className="shrink-0 text-xs text-ink-muted">{c.when}</span>
                    </span>
                    <span className="block truncate text-sm text-ink-muted">{c.last}</span>
                    <span className="text-xs text-ink-muted">
                      {c.windowOpen ? "Reply window open" : "Window closed"}
                      {c.handled ? " · Handled" : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </Card>
          )
        ) : d.list.length === 0 ? (
          <EmptyState>{tab === "scheduled" ? "Nothing scheduled." : tab === "sent" ? "Nothing sent today yet." : "No failed messages this week."}</EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {d.list.map((m) => (
              <div key={m.id} className="px-4 py-3">
                <div className="flex justify-between gap-2">
                  <Link href={`/app/customers/${m.customerId}`} className="font-semibold">
                    {m.customer}
                  </Link>
                  <Badge tone={MESSAGE_BADGE[m.status].tone}>{MESSAGE_BADGE[m.status].label}</Badge>
                </div>
                <p className="text-sm text-ink-muted">
                  {m.type} · {m.when}
                  {m.reason ? ` · ${m.reason.replace(/_/g, " ")}` : ""}
                </p>
                <p className="mt-1 [overflow-wrap:anywhere]">{m.text}</p>
              </div>
            ))}
          </Card>
        )}

        {d.failures.length > 0 && tab !== "failed" && (
          <section>
            <h2 className="mb-2 text-xl font-bold">Needs attention</h2>
            <Card className="divide-y divide-border">
              {d.failures.map((f) => (
                <div key={f.id} className="space-y-2 px-4 py-3">
                  <div className="flex justify-between">
                    <span className="font-semibold">{f.customer}</span>
                    <Badge tone="red">Failed</Badge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {f.type} was not delivered. {f.notOnWhatsApp ? "This number may not be on WhatsApp." : (f.reason ?? "").replace(/_/g, " ")}
                  </p>
                  <FailureActions messageId={f.id} customerId={f.customerId} notOnWhatsApp={f.notOnWhatsApp} />
                </div>
              ))}
            </Card>
          </section>
        )}

        {showDevTools && s.member.role === "owner" && <DevTools />}
      </div>
    </>
  );
}
