// Send an offer to a customer group — PRD §7 flow 5, BR-PR1–PR3.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AINotice, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { isPromotionActive } from "@/domain/offers";
import { localDateKey } from "@/domain/time";
import { requirePage } from "@/server/auth/guards";
import { requireStaff } from "@/server/auth/session";
import { forSalon } from "@/server/db";
import { CAMPAIGN_SEGMENTS } from "@/server/staff/campaigns";
import { CampaignForm } from "./campaign-form";

export const instant = false;

export default async function OffersPage() {
  await requirePage("promotions.approve");
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <Offers />
    </Suspense>
  );
}

async function Offers() {
  await connection();
  const s = await requireStaff();
  const today = localDateKey(new Date(), s.salon.timezone);
  const promos = (await forSalon(s.member.salonId).promotion.findMany({ where: { active: true, isBirthday: false }, orderBy: { createdAt: "desc" } })).filter((p) =>
    isPromotionActive(p, today),
  );
  return (
    <>
      <PageHeader title="Send an offer" subtitle="To a group of customers" back={{ href: "/app/whatsapp", label: "WhatsApp" }} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        {promos.length === 0 ? (
          <EmptyState action={<Link href="/app/settings#offers" className="font-semibold text-brand-900 underline">Create an offer</Link>}>
            No offer is running today. Offers are set up in Settings, so the discount in every message always matches the real offer.
          </EmptyState>
        ) : (
          <>
            <AINotice />
            <CampaignForm promotions={promos.map((p) => ({ id: p.id, name: p.name }))} segments={CAMPAIGN_SEGMENTS} />
          </>
        )}
      </div>
    </>
  );
}
