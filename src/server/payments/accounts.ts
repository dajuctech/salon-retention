// Connecting a salon's own payment account (ADR-0006): a Paystack subaccount created from the
// salon's bank details, or a Stripe Standard account the owner sets up on Stripe's own pages.
// In test mode (PAYMENTS_MODE=fake) these are simulated and nothing leaves the server.
import { cacheLife } from "next/cache";
import { paymentsMode } from "./providers";

export type Bank = { code: string; name: string };

/** Paystack's currencies; other salons use Stripe. */
export const PAYSTACK_CURRENCIES = new Set(["NGN", "GHS", "KES", "ZAR"]);

const FAKE_BANKS: Bank[] = [
  { code: "058", name: "Test Bank A" },
  { code: "044", name: "Test Bank B" },
];

function paystackSecret(): string {
  const s = process.env.PAYSTACK_SECRET_KEY;
  if (!s) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return s;
}

function stripeSecret(): string {
  const s = process.env.STRIPE_SECRET_KEY;
  if (!s) throw new Error("STRIPE_SECRET_KEY is not set");
  return s;
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; error?: { message?: string } };
  if (!res.ok) throw new ProviderError(body.message ?? body.error?.message ?? `${what} failed (${res.status})`, res.status);
  return body;
}

/** A provider refusal we can show the owner (e.g. "Account number is invalid"). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Banks a Paystack subaccount can settle to, for the salon's currency. Cached for a day. */
export async function paystackBanks(currency: string): Promise<Bank[]> {
  if (paymentsMode() === "fake") return FAKE_BANKS;
  return liveBanks(currency);
}

async function liveBanks(currency: string): Promise<Bank[]> {
  "use cache";
  cacheLife("days");
  const res = await fetch(`https://api.paystack.co/bank?currency=${encodeURIComponent(currency)}&perPage=200`, {
    headers: { Authorization: `Bearer ${paystackSecret()}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await json<{ data?: { code: string; name: string; active?: boolean }[] }>(res, "Bank list");
  return (body.data ?? []).filter((b) => b.active !== false).map((b) => ({ code: b.code, name: b.name }));
}

/** Creates the salon's subaccount. The salon bears Paystack's fees; our fee is set per charge. */
export async function createPaystackSubaccount(input: { salonId: string; businessName: string; bankCode: string; accountNumber: string }): Promise<{ account: string; label: string }> {
  const last4 = input.accountNumber.slice(-4);
  if (paymentsMode() === "fake") {
    const bank = FAKE_BANKS.find((b) => b.code === input.bankCode);
    if (!bank) throw new ProviderError("Choose your bank.", 400);
    return { account: `ACCT_test_${input.salonId}`, label: `${bank.name} ••••${last4}` };
  }
  const res = await fetch("https://api.paystack.co/subaccount", {
    method: "POST",
    headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      business_name: input.businessName,
      settlement_bank: input.bankCode,
      account_number: input.accountNumber,
      percentage_charge: 0,
      metadata: { salonId: input.salonId },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await json<{ data?: { subaccount_code?: string; settlement_bank?: string; account_name?: string } }>(res, "Paystack");
  if (!body.data?.subaccount_code) throw new ProviderError("Paystack didn't create the account. Check the details and try again.", 502);
  const bank = body.data.settlement_bank ?? "Bank";
  return { account: body.data.subaccount_code, label: `${body.data.account_name ? `${body.data.account_name}, ` : ""}${bank} ••••${last4}` };
}

/** Creates a Stripe Standard account for the salon; the owner completes it on Stripe. */
export async function createStripeAccount(input: { salonId: string; countryCode: string; email: string }): Promise<string> {
  if (paymentsMode() === "fake") return `acct_test_${input.salonId}`;
  const res = await fetch("https://api.stripe.com/v1/accounts", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeSecret()}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `salon-account-${input.salonId}` },
    body: new URLSearchParams({ type: "standard", country: input.countryCode, email: input.email, "metadata[salonId]": input.salonId }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await json<{ id?: string }>(res, "Stripe");
  if (!body.id) throw new ProviderError("Stripe didn't create the account.", 502);
  return body.id;
}

/** A one-time link to Stripe's onboarding pages. In test mode it comes straight back as finished. */
export async function stripeOnboardingLink(account: string, refreshUrl: string, returnUrl: string): Promise<string> {
  if (paymentsMode() === "fake") return returnUrl;
  const res = await fetch("https://api.stripe.com/v1/account_links", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeSecret()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ account, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await json<{ url?: string }>(res, "Stripe");
  if (!body.url) throw new ProviderError("Stripe didn't return an onboarding link.", 502);
  return body.url;
}

/** Whether the Stripe account can take charges yet, and a label for Settings. */
export async function stripeAccountStatus(account: string): Promise<{ ready: boolean; label: string }> {
  if (paymentsMode() === "fake") return { ready: true, label: "Stripe test account" };
  const res = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(account)}`, {
    headers: { Authorization: `Bearer ${stripeSecret()}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await json<{ charges_enabled?: boolean; business_profile?: { name?: string | null }; email?: string | null }>(res, "Stripe");
  return { ready: body.charges_enabled === true, label: `Stripe: ${body.business_profile?.name || body.email || account}` };
}
