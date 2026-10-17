// Shared layout for staff auth screens — design p3.
import { Scissors } from "lucide-react";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-brand-900">
      <header className="px-7 pb-10 pt-14 text-white">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-500 text-brand-900">
          <Scissors className="size-7" aria-hidden />
        </div>
        <p className="mt-6 font-semibold text-accent-500">{eyebrow}</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-white/85">{subtitle}</p>
      </header>
      <main className="flex-1 rounded-t-[2rem] bg-surface px-6 pb-10 pt-8">{children}</main>
    </div>
  );
}

export function FormMessage({ error, info }: { error?: string; info?: string }) {
  if (error) {
    return (
      <p role="alert" className="mb-4 rounded-xl bg-status-danger px-4 py-3 text-sm text-status-danger-ink">
        {error}
      </p>
    );
  }
  if (info) {
    return (
      <p role="status" className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
        {info}
      </p>
    );
  }
  return null;
}
