// Customer profile — design p7 (+ review changes: consent, data rights, barber variant).
import { Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BOOKING_BADGE, Badge, Card, MESSAGE_BADGE, PAYMENT_BADGE, SectionTitle, Skeleton } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz";
import { customerProfile } from "@/server/staff/queries/customers";
import { typeLabel } from "@/server/staff/queries/dashboard";
import { ConsentToggles, DataRights } from "./profile-client";
import { requireRecord } from "@/server/auth/guards";

export const instant = false;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function CustomerPage({ params }: PageProps<"/app/customers/[id]">) {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requireRecord("customer", (await params).id);
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Customer params={params} />
    </Suspense>
  );
}

async function Customer({ params }: { params: PageProps<"/app/customers/[id]">["params"] }) {
  await connection();
  const s = await requireStaff();
  const { id } = await params;
  // A barber opening a customer they've never served gets the same 404 as a missing customer.
  const c = await customerProfile(s, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!c) notFound();
  const money = (m: number) => formatMoney(m, s.salon.currency);
  const wa = (c.phoneE164 ?? "").replace(/[^\d]/g, "");
  const role = s.member.role;
  const first = c.name.split(" ")[0];

  return (
    <>
      <header className="bg-brand-900 px-5 pb-5 pt-5 text-white">
        <Link href="/app/customers" className="text-sm text-white/85">
          ‹ Customers
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <span className="flex size-16 items-center justify-center rounded-full bg-accent-500 text-xl font-bold text-brand-900" aria-hidden>
            {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          <div>
            <h1 className="text-3xl font-bold">{c.name}</h1>
            <p className="text-white/85">{c.phone}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {c.visits >= 5 && <span className="rounded-full bg-accent-500 px-2.5 py-0.5 text-xs font-bold text-brand-900">Regular</span>}
              {c.due && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-brand-900">Due to return</span>}
              {c.phoneInvalid && <span className="rounded-full bg-status-danger px-2.5 py-0.5 text-xs font-bold text-status-danger-ink">Not on WhatsApp</span>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {c.canContact ? (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="rounded-xl bg-accent-500 py-2.5 text-center font-semibold text-brand-900">
              WhatsApp
            </a>
          ) : (
            <span />
          )}
          <Link href={`/app/bookings/new?customer=${c.id}`} className="rounded-xl bg-white/15 py-2.5 text-center font-semibold">
            Book
          </Link>
          {c.canContact ? (
            <a href={`tel:${c.phoneE164}`} className="rounded-xl bg-white/15 py-2.5 text-center font-semibold">
              Call
            </a>
          ) : (
            <span />
          )}
        </div>
      </header>

      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3">
            <p className="text-sm text-ink-muted">Visits</p>
            <p className="text-2xl font-bold">{c.visits}</p>
          </Card>
          <Card className="p-3">
            <p className="text-sm text-ink-muted">Total spent</p>
            <p className="text-xl font-bold">{money(c.totalSpentMinor)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-sm text-ink-muted">Usual gap</p>
            <p className="text-2xl font-bold">{c.usualGapDays ? (c.usualGapDays >= 14 ? `${Math.round(c.usualGapDays / 7)} wks` : `${c.usualGapDays} days`) : "—"}</p>
          </Card>
        </div>

        {c.loyalty && (
          <section className="rounded-2xl bg-accent-50 p-4" aria-label="Loyalty card">
            <div className="flex justify-between">
              <h2 className="text-lg font-bold text-[#5a4210]">Loyalty card</h2>
              <p className="font-semibold text-[#5a4210]">
                {Math.min(c.loyalty.stamps, c.loyalty.threshold)} of {c.loyalty.threshold} cuts
              </p>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2" aria-hidden>
              {Array.from({ length: c.loyalty.threshold }, (_, i) => (
                <span
                  key={i}
                  className={`flex aspect-square items-center justify-center rounded-full ${i < c.loyalty!.stamps ? "bg-brand-900 text-accent-500" : "border-2 border-[#a07a2a]"}`}
                >
                  {i < c.loyalty!.stamps && <Check className="size-4" />}
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm text-[#5a4210]">
              {c.loyalty.rewardAvailable
                ? "Free cut ready. Use it when recording their next payment."
                : `${c.loyalty.threshold - c.loyalty.stamps} more cut${c.loyalty.threshold - c.loyalty.stamps === 1 ? "" : "s"} for a free haircut.`}
            </p>
          </section>
        )}

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Details</h2>
            {can(role, "customers.edit") && (
              <Link href={`/app/customers/${c.id}/edit`} className="text-sm font-semibold text-brand-900 underline">
                Edit
              </Link>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-ink-muted">Last visit</dt>
            <dd className="font-semibold">{c.lastVisit ?? "No visits yet"}</dd>
            <dt className="text-ink-muted">Usual service</dt>
            <dd className="font-semibold">{c.usualService ?? "—"}</dd>
            <dt className="text-ink-muted">Barber</dt>
            <dd className="font-semibold">{c.barber ?? "—"}</dd>
            <dt className="text-ink-muted">Birthday</dt>
            <dd className="font-semibold">{c.birthMonth && c.birthDay ? `${c.birthDay} ${MONTHS[c.birthMonth - 1]}` : "—"}</dd>
            <dt className="text-ink-muted">WhatsApp</dt>
            <dd className="font-semibold">
              {c.utilityConsent ? "Reminders on" : "Reminders off"} · {c.marketingConsent ? "Offers on" : "Offers off"}
            </dd>
          </dl>
          {(c.notes || c.preferredStyle) && (
            <div className="mt-3 rounded-xl bg-surface p-3">
              <p className="font-semibold">Notes</p>
              <p className="whitespace-pre-line">{[c.preferredStyle, c.notes].filter(Boolean).join("\n")}</p>
            </div>
          )}
        </Card>

        {role !== "barber" && c.due && (
          <section className="rounded-2xl bg-brand-900 p-4 text-white">
            <h2 className="text-lg font-bold">Bring {first} back</h2>
            {c.marketingConsent ? (
              <>
                <p className="mt-1 text-white/85">
                  {c.usualGapDays ? `${first} usually comes every ${c.usualGapDays >= 14 ? `${Math.round(c.usualGapDays / 7)} weeks` : `${c.usualGapDays} days`}` : `${first} is due`}
                  {c.weeksSince ? ` and it's been ${c.weeksSince}.` : "."} {role === "owner" ? "Review the message and approve it before it sends." : "The owner reviews follow-up messages before they send."}
                </p>
                {role === "owner" && (
                  <Link href={c.draftId ? `/app/whatsapp/approve#${c.draftId}` : "/app/whatsapp/approve"} className="mt-3 block rounded-xl bg-accent-500 py-3 text-center font-semibold text-brand-900">
                    {c.draftId ? "Review the drafted message" : "Open follow-up queue"}
                  </Link>
                )}
              </>
            ) : (
              <p className="mt-1 text-white/85">Can&apos;t message: {first} hasn&apos;t agreed to offers or return reminders.</p>
            )}
          </section>
        )}

        {can(role, "consent.edit") && <ConsentToggles customerId={c.id} utility={c.utilityConsent} marketing={c.marketingConsent} />}

        <SectionTitle>Visit history</SectionTitle>
        {c.history.length === 0 ? (
          <p className="text-ink-muted">No visits yet.</p>
        ) : (
          <Card className="divide-y divide-border">
            {c.history.map((h) => (
              <Link key={h.id} href={`/app/bookings/${h.id}`} className="flex items-center justify-between px-4 py-3">
                <span>
                  <span className="block font-semibold">
                    {h.date} · {h.time}
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {h.service} · {h.barber}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-bold">{h.free ? "Free cut" : money(h.priceMinor)}</span>
                  {h.payment && h.status !== "CONFIRMED" ? (
                    <span className={`text-sm font-semibold ${h.payment === "PAID" ? "text-brand-900" : "text-status-danger-ink"}`}>{PAYMENT_BADGE[h.payment].label}</span>
                  ) : (
                    <Badge tone={BOOKING_BADGE[h.status].tone}>{BOOKING_BADGE[h.status].label}</Badge>
                  )}
                </span>
              </Link>
            ))}
          </Card>
        )}

        {c.messages.length > 0 && (
          <>
            <SectionTitle>Messages</SectionTitle>
            <Card className="divide-y divide-border">
              {c.messages.map((m) => (
                <div key={m.id} className="px-4 py-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-muted">
                      {typeLabel(m.type)} · {m.date}
                    </span>
                    <span className={`font-semibold ${m.status === "FAILED" ? "text-status-danger-ink" : "text-brand-900"}`}>{MESSAGE_BADGE[m.status].label}</span>
                  </div>
                  <p className="mt-1 [overflow-wrap:anywhere]">{m.text}</p>
                  {m.reason && m.status !== "DELIVERED" && <p className="text-xs text-ink-muted">{m.reason.replace(/_/g, " ")}</p>}
                </div>
              ))}
            </Card>
          </>
        )}

        {can(role, "customers.exportDelete") && <DataRights customerId={c.id} name={c.name} />}
      </div>
    </>
  );
}
