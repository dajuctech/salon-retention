"use client";

// Client-side UI pieces: the bottom tab bar (design p4–p12) and a pending-aware submit button.
import { BarChart3, Calendar, CircleUser, CreditCard, Home, MessageCircle, MoreHorizontal, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

const TABS = [
  { href: "/app", label: "Home", icon: Home, match: (p: string) => p === "/app" },
  { href: "/app/calendar", label: "Calendar", icon: Calendar, match: (p: string) => p.startsWith("/app/calendar") || p.startsWith("/app/bookings") || p.startsWith("/app/walk-in") },
  { href: "/app/customers", label: "Customers", icon: Users, match: (p: string) => p.startsWith("/app/customers") },
  { href: "/app/whatsapp", label: "WhatsApp", icon: MessageCircle, match: (p: string) => p.startsWith("/app/whatsapp"), staffOnly: true },
  {
    href: "/app/more",
    label: "More",
    icon: MoreHorizontal,
    match: (p: string) => ["/app/more", "/app/payments", "/app/reports", "/app/settings"].some((x) => p.startsWith(x)),
  },
];

export function TabBar({ showWhatsApp, unread }: { showWhatsApp: boolean; unread: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-md">
        {TABS.filter((t) => showWhatsApp || !t.staffOnly).map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 border-t-[3px] py-2 text-xs ${active ? "border-accent-500 font-bold text-brand-900" : "border-transparent text-ink-muted"}`}
              >
                <Icon className="size-6" aria-hidden />
                {label}
                {label === "WhatsApp" && unread > 0 && (
                  <span className="absolute right-[22%] top-1 rounded-full bg-status-danger-ink px-1.5 text-[10px] font-bold text-white">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SubmitButton({
  children,
  pendingText,
  className,
  name,
  value,
  formAction,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className: string;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} name={name} value={value} formAction={formAction}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** UI plan §4 "Offline / slow": tells staff when the connection drops, so a failed save isn't a mystery. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <p role="status" className="sticky top-0 z-30 bg-status-in-chair px-5 py-2 text-center text-sm font-semibold text-[#5a3d00]">
      You&apos;re offline. Changes can&apos;t be saved until you&apos;re back online.
    </p>
  );
}

/** Large screens (front-desk laptop or tablet in landscape): a side navigation instead of the tab bar. */
export function SideNav({ role, unread, salonName }: { role: "owner" | "receptionist" | "barber"; unread: number; salonName: string }) {
  const pathname = usePathname();
  // Same visibility as the More screen (docs/permissions.md): never link to a page the role can't open.
  const items = [
    ...TABS.filter((t) => role !== "barber" || !t.staffOnly).filter((t) => t.label !== "More"),
    { href: "/app/payments", label: "Payments", icon: CreditCard, match: (p: string) => p.startsWith("/app/payments") },
    ...(role === "owner" ? [{ href: "/app/reports", label: "Reports", icon: BarChart3, match: (p: string) => p.startsWith("/app/reports") }] : []),
    ...(role !== "receptionist"
      ? [{ href: "/app/settings", label: role === "barber" ? "My hours" : "Settings", icon: Settings, match: (p: string) => p.startsWith("/app/settings") }]
      : []),
    { href: "/app/more", label: "Account", icon: CircleUser, match: (p: string) => p.startsWith("/app/more") },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col gap-1 bg-brand-900 p-4 text-white lg:flex">
      <p className="mb-4 px-3 text-lg font-bold">{salonName}</p>
      {items.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold ${active ? "bg-accent-500 text-brand-900" : "text-white/85 hover:bg-white/10"}`}
          >
            <Icon className="size-5" aria-hidden />
            {label}
            {label === "WhatsApp" && unread > 0 && <span className="ml-auto rounded-full bg-status-danger-ink px-2 text-xs">{unread}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
