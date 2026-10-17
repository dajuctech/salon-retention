import Link from "next/link";

// Platform landing placeholder. The demo salon comes from `pnpm db:seed`.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="rounded-card bg-brand-900 p-6 text-white">
        <p className="text-sm text-accent-500">Development</p>
        <h1 className="text-2xl font-semibold">Salon Retention &amp; Booking</h1>
        <p className="mt-2 text-sm text-white/80">Built so far: customer booking and confirmation (design p1–p2).</p>
        <Link
          href="/sharpandco"
          className="mt-5 inline-block rounded-xl bg-accent-500 px-4 py-3 font-semibold text-brand-900"
        >
          Open the Sharp &amp; Co. booking page →
        </Link>
      </div>
    </main>
  );
}
