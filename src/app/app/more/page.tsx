// "More" tab: payments, reports, settings, salon switch, sign out.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOutAction, switchSalonAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/client";
import { Card, PageHeader, Skeleton, outlineButton } from "@/components/ui";
import { can } from "@/domain/permissions";
import { currentUser, membershipsFor, requireStaff } from "@/server/auth/session";
import { bookingPageUrl } from "@/server/messaging/queue";
import { CopyLink } from "../ui-client";
import { TwoFactorCard } from "./two-factor";

export const instant = false;

export default function MorePage() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <More />
    </Suspense>
  );
}

async function More() {
  await connection();
  const s = await requireStaff();
  const role = s.member.role;
  const memberships = await membershipsFor(s.user.id);
  const user = await currentUser();
  const links = [
    { href: "/app/payments", label: "Payments", show: can(role, "payments.record", true) },
    { href: "/app/reports", label: "Reports", show: can(role, "reports.view") },
    { href: "/app/settings", label: role === "barber" ? "My hours" : "Settings", show: role !== "receptionist" },
  ].filter((l) => l.show);

  return (
    <>
      <PageHeader title="More" subtitle={`${s.user.name} · ${role} at ${s.salon.name}`} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        <Card className="divide-y divide-border">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center justify-between px-4 py-4 font-semibold">
              {l.label}
              <ChevronRight className="size-5 text-ink-muted" aria-hidden />
            </Link>
          ))}
        </Card>
        <Card className="p-4">
          <p className="font-semibold">Your booking link</p>
          <p className="text-sm text-ink-muted">Share it on WhatsApp, Instagram or as a QR code at the till.</p>
          <CopyLink link={bookingPageUrl(s.salon.slug)} />
        </Card>
        {memberships.length > 1 && (
          <Card className="p-4">
            <p className="font-semibold">Switch salon</p>
            <div className="mt-2 space-y-2">
              {memberships.map((m) => (
                <form key={m.salonId} action={switchSalonAction}>
                  <input type="hidden" name="salonId" value={m.salonId} />
                  <SubmitButton className={`${outlineButton} ${m.salonId === s.salon.id ? "border-brand-900" : ""}`}>
                    {m.salon.name} · {m.role}
                  </SubmitButton>
                </form>
              ))}
            </div>
          </Card>
        )}
        <TwoFactorCard enabled={Boolean((user as { twoFactorEnabled?: boolean | null } | null)?.twoFactorEnabled)} recommended={role === "owner"} />
        <form action={signOutAction}>
          <SubmitButton className={`${outlineButton} text-status-danger-ink`} pendingText="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
    </>
  );
}
