// Shared UI pieces matching design/*.pdf (UI_UX_DESIGN_PLAN §1).
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { initials } from "@/domain/format";

export function PageHeader({
  title,
  subtitle,
  userName,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  userName?: string;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <header className="bg-brand-900 px-5 pb-5 pt-5 text-white">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm text-white/85">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-white/80">{subtitle}</p>}
        </div>
        {userName && (
          <Link
            href="/app/more"
            aria-label="Account and more"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-500 font-bold text-brand-900"
          >
            {initials(userName)}
          </Link>
        )}
      </div>
      {children}
    </header>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-2xl border border-border bg-card ${className}`}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="text-xl font-bold">{children}</h2>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "plain",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "plain" | "dark" | "danger";
  href?: string;
}) {
  const body = (
    <>
      <p className={`text-sm ${tone === "dark" ? "text-white/85" : "text-ink-muted"}`}>{label}</p>
      <p
        className={`mt-1 text-3xl font-bold ${tone === "dark" ? "text-accent-500" : tone === "danger" ? "text-status-danger-ink" : "text-brand-900"}`}
      >
        {value}
      </p>
      {sub && <p className={`mt-1 text-sm ${tone === "dark" ? "text-white/85" : "text-ink-muted"}`}>{sub}</p>}
    </>
  );
  const cls = `block rounded-2xl p-4 ${tone === "dark" ? "bg-brand-900 text-white" : "border border-border bg-card"}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export type Tone = "green" | "amber" | "grey" | "red" | "blue";
const TONES: Record<Tone, string> = {
  green: "bg-status-confirmed text-brand-900",
  amber: "bg-status-in-chair text-[#7a5200]",
  grey: "bg-status-done text-ink",
  red: "bg-status-danger text-status-danger-ink",
  blue: "bg-status-new text-[#1d4f91]",
};

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${TONES[tone]}`}>{children}</span>;
}

export const BOOKING_BADGE: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "amber" },
  CONFIRMED: { label: "Confirmed", tone: "green" },
  IN_PROGRESS: { label: "In chair", tone: "amber" },
  COMPLETED: { label: "Done", tone: "grey" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
  NO_SHOW: { label: "No-show", tone: "red" },
};

export const PAYMENT_BADGE: Record<string, { label: string; tone: Tone }> = {
  UNPAID: { label: "Unpaid", tone: "red" },
  PART_PAID: { label: "Balance", tone: "amber" },
  PAID: { label: "Paid", tone: "green" },
  REFUNDED: { label: "Refunded", tone: "grey" },
};

export const MESSAGE_BADGE: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "amber" },
  QUEUED: { label: "Scheduled", tone: "green" },
  SENDING: { label: "Sending", tone: "green" },
  SENT: { label: "Sent", tone: "green" },
  DELIVERED: { label: "Delivered", tone: "green" },
  READ: { label: "Read", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SKIPPED: { label: "Skipped", tone: "grey" },
};

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-900 ${size === "lg" ? "size-16 text-xl" : "size-11 text-sm"}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-ink-muted">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export const inputClass =
  "mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-base outline-none focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20";
export const labelClass = "block text-sm font-semibold";
export const primaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-900 px-4 py-3.5 text-base font-semibold text-white transition disabled:cursor-wait disabled:opacity-70";
export const goldButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 px-4 py-3.5 text-base font-semibold text-brand-900 transition disabled:opacity-70";
export const outlineButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold text-brand-900 transition disabled:opacity-60";

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-24 bg-brand-900" />
      <div className="space-y-3 p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-card" />
        ))}
      </div>
    </div>
  );
}

/** What owners should know about AI suggestions (docs/ai-model-card.md, in plain words). */
export function AINotice() {
  return (
    <details className="rounded-2xl border border-border bg-card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">How AI suggestions work</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
        <li>An AI model suggests wording. It never sends anything: you choose, edit and approve.</li>
        <li>It only sees your salon name, the offer and placeholders like {"{{first_name}}"}, never your customers&apos; names or numbers.</li>
        <li>Every suggestion is checked against the message rules first. Ones that fail aren&apos;t shown.</li>
        <li>It can still get things wrong, for example a tone that doesn&apos;t sound like you. Read it before you approve.</li>
        <li>Each suggestion uses a little of your monthly AI budget. You can always write the wording yourself.</li>
      </ul>
    </details>
  );
}
