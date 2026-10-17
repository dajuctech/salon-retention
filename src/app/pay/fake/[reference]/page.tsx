// Development only: a stand-in for the provider's checkout page (PAYMENTS_MODE=fake).
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { formatMoney } from "@/domain/money";
import { derivePaymentStatus } from "@/domain/payment-status";
import { findSalonBySlug, forSalon } from "@/server/db";
import { paymentsMode, bookingIdFromReference } from "@/server/payments/providers";
import { recordOnlinePayment } from "@/server/platform/payments";

export const instant = false;

function allowed() {
  return paymentsMode() === "fake" && (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_TOOLS === "true");
}

export default async function FakeCheckout({ params, searchParams }: PageProps<"/pay/fake/[reference]">) {
  await connection();
  if (!allowed()) notFound();
  const { reference } = await params;
  const sp = await searchParams;
  const back = typeof sp.back === "string" && sp.back.startsWith(process.env.APP_URL ?? "http://localhost") ? sp.back : "/";
  const slug = new URL(back, "http://x").pathname.split("/")[1];
  const salon = slug ? await findSalonBySlug(slug) : null;
  const bookingId = bookingIdFromReference(reference);
  if (!salon || !bookingId) notFound();
  const booking = await forSalon(salon.id).booking.findFirst({ where: { id: bookingId }, include: { payments: true } });
  if (!booking) notFound();
  const { balanceMinor } = derivePaymentStatus(booking.priceMinor, booking.payments);

  async function pay() {
    "use server";
    if (!allowed() || !booking) return;
    // The amount is taken from the database, never from the link.
    await recordOnlinePayment("FAKE", { reference, bookingId: booking.id, amountMinor: balanceMinor, currency: booking.currency, account: null });
    redirect(back);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <p className="rounded-xl bg-status-in-chair px-4 py-2 text-sm font-semibold text-[#5a3d00]">Test checkout: no real money moves</p>
      <h1 className="text-2xl font-bold">Pay {salon.name}</h1>
      <p className="text-4xl font-bold">{formatMoney(balanceMinor, booking.currency)}</p>
      {balanceMinor > 0 ? (
        <form action={pay}>
          <button className="w-full rounded-2xl bg-brand-900 py-4 text-lg font-semibold text-white">Pay (test)</button>
        </form>
      ) : (
        <p>This booking is already paid.</p>
      )}
    </main>
  );
}
