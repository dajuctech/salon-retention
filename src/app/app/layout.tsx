// Staff app shell: mobile-width column (design p4–p12) with the bottom tab bar.
import { Suspense } from "react";
import Link from "next/link";
import { OfflineBanner, SideNav, TabBar } from "@/components/client";
import { requireStaff } from "@/server/auth/session";
import { forSalon } from "@/server/db";

export const metadata = { title: "Salon · Staff" };

export default function StaffLayout({ children }: LayoutProps<"/app">) {
  return (
    // Phone-first column; wider on tablets; side navigation and a wide canvas on large screens.
    <div className="mx-auto min-h-screen w-full max-w-md overflow-x-clip pb-24 md:max-w-3xl lg:max-w-none lg:pb-8 lg:pl-56">
      <OfflineBanner />
      <Suspense fallback={null}>
        <PausedBanner />
      </Suspense>
      {children}
      <Suspense fallback={null}>
        <TabBarLoader />
      </Suspense>
    </div>
  );
}

/** UI plan §4 "Messaging paused": on every staff screen, so nobody assumes reminders went out. */
async function PausedBanner() {
  const { member, salon } = await requireStaff();
  if (member.role === "barber" || !(salon.messagingPaused || process.env.MESSAGING_PAUSED === "true")) return null;
  return (
    <p role="status" className="bg-status-danger px-5 py-2 text-center text-sm font-semibold text-status-danger-ink">
      WhatsApp sending is paused. Messages are queued.{" "}
      <Link href="/app/whatsapp" className="underline">
        Manage
      </Link>
    </p>
  );
}

async function TabBarLoader() {
  const { member } = await requireStaff();
  const isBarber = member.role === "barber";
  const unread = isBarber ? 0 : ((await forSalon(member.salonId).conversation.aggregate({ _sum: { unreadCount: true } }))._sum.unreadCount ?? 0);
  const s = await requireStaff();
  return (
    <>
      <TabBar showWhatsApp={!isBarber} unread={unread} />
      <SideNav role={member.role} unread={unread} salonName={s.salon.name} />
    </>
  );
}
