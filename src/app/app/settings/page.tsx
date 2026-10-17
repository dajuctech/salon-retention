// Settings — design p12 (+ staff, offers, closed dates). Owners see everything; barbers see their hours.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { formatMoney, toMinor } from "@/domain/money";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { bookingPageUrl } from "@/server/messaging/queue";
import { settingsData } from "@/server/staff/queries/settings";
import { paymentsMode } from "@/server/payments/providers";
import { BarberRow, ClosedDates, OffersSection, OpeningHoursForm, PaymentsForm, ProfileForm, RulesForm, ServiceRow, StaffSection } from "./settings-client";
import { requireRole } from "@/server/auth/guards";
import { PAYSTACK_CURRENCIES, paystackBanks } from "@/server/payments/accounts";

export const instant = false;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function hoursSummary(hours: { weekday: number; startMin: number; endMin: number }[]): string {
  if (hours.length === 0) return "No hours set";
  const days = [...new Set(hours.map((h) => h.weekday))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const first = hours[0];
  const same = hours.every((h) => h.startMin === first.startMin && h.endMin === first.endMin);
  const span = days.length > 2 ? `${DAY[days[0]]} to ${DAY[days.at(-1)!]}` : days.map((d) => DAY[d]).join(", ");
  return same ? `${span} · ${hm(first.startMin)} to ${hm(first.endMin)}` : `${span} · varies`;
}

export default async function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  await requireRole("owner", "barber");
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({ searchParams }: { searchParams: PageProps<"/app/settings">["searchParams"] }) {
  await connection();
  const s = await requireStaff();
  const role = s.member.role;
  if (role === "receptionist") notFound();
  const returned = (await searchParams).payments;
  const d = await settingsData(s);
  const timezones = Intl.supportedValuesOf("timeZone");

  if (role === "barber") {
    const mine = d.barbers.filter((b) => b.id === s.member.barberId);
    return (
      <>
        <PageHeader title="My hours" subtitle={s.salon.name} userName={s.user.name} />
        <div className="px-5 pt-5">
          <Card className="divide-y divide-border">
            {mine.map((b) => (
              <BarberRow key={b.id} barber={b} canEditAll={false} summary={hoursSummary(b.hours)} />
            ))}
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle={d.salon.name} userName={s.user.name} />
      <div className="space-y-2 px-5 pt-5">
        <ProfileForm name={d.salon.name} whatsappNumber={d.salon.whatsappNumber ?? ""} timezone={d.salon.timezone} bookingLink={bookingPageUrl(d.salon.slug)} timezones={timezones} />

        <SectionTitle>
          <span id="services">Services</span>
        </SectionTitle>
        <Card className="divide-y divide-border">
          {d.services.map((sv) => (
            <ServiceRow key={sv.id} service={sv} priceLabel={formatMoney(toMinor(sv.price, d.salon.currency), d.salon.currency)} />
          ))}
          <div className="p-3">
            <ServiceRow service={null} priceLabel="" />
          </div>
        </Card>

        <SectionTitle>
          <span id="barbers">Barbers</span>
        </SectionTitle>
        <Card className="divide-y divide-border">
          {d.barbers.map((b) => (
            <BarberRow key={b.id} barber={b} canEditAll summary={hoursSummary(b.hours)} />
          ))}
          <div className="p-3">
            <BarberRow barber={null} canEditAll summary="" />
          </div>
        </Card>

        <SectionTitle>Opening hours</SectionTitle>
        <Card className="divide-y divide-border">
          <OpeningHoursForm hours={d.opening} />
          <ClosedDates closed={d.closed} />
        </Card>

        <SectionTitle>Booking rules</SectionTitle>
        <Card>
          <RulesForm
            bookingEnabled={d.salon.bookingEnabled}
            autoConfirm={d.salon.autoConfirm}
            cancelCutoffMinutes={d.salon.cancelCutoffMinutes}
            loyaltyOn={d.salon.loyaltyOn}
            loyaltyThreshold={d.salon.loyaltyThreshold}
            slotGridMinutes={d.salon.slotGridMinutes}
          />
        </Card>

        <SectionTitle>
          <span id="payments">Payments</span>
        </SectionTitle>
        <Card>
          <PaymentsForm
            provider={d.salon.paymentProvider}
            testMode={paymentsMode() === "fake"}
            account={{ connected: Boolean(d.salon.paymentProviderAccount), ready: d.salon.paymentAccountReady, label: d.salon.paymentAccountLabel }}
            banks={d.salon.paymentProvider === "PAYSTACK" && !d.salon.paymentAccountReady ? await paystackBanks(d.salon.currency).catch(() => null) : []}
            paystackAllowed={PAYSTACK_CURRENCIES.has(d.salon.currency)}
            returned={typeof returned === "string" ? returned : null}
          />
        </Card>

        <SectionTitle>
          <span id="offers">Offers</span>
        </SectionTitle>
        <Card>
          <OffersSection promotions={d.promotions} services={d.services.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))} currency={d.salon.currency} />
        </Card>

        {can(role, "staff.manage") && (
          <>
            <SectionTitle>Staff</SectionTitle>
            <Card>
              <StaffSection members={d.members} invitations={d.invitations} unlinkedBarbers={d.barbers.filter((b) => !b.hasLogin).map((b) => ({ id: b.id, displayName: b.displayName }))} />
            </Card>
          </>
        )}

        <section className="mt-6 rounded-2xl bg-accent-50 p-4">
          <h2 className="text-lg font-bold text-[#5a4210]">AI messages</h2>
          <p className="text-[#5a4210]">Every follow-up message needs your approval before it sends. This can&apos;t be turned off.</p>
        </section>
      </div>
    </>
  );
}
