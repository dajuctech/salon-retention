// Online payment providers (ADR-0006, US-17, BR-P3). Only a webhook with a verified signature can
// mark a booking paid; the customer's return to our site is never trusted. Every charge is made on
// the salon's own connected account (Paystack subaccount / Stripe Connect), so we never hold funds.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ProviderKind = "PAYSTACK" | "STRIPE" | "FAKE";

export type LinkRequest = {
  bookingId: string;
  amountMinor: number;
  currency: string;
  description: string;
  customerEmail?: string | null;
  returnUrl: string;
  /** The salon's connected account: Paystack subaccount code or Stripe account id. */
  account: string;
  /** Our fee, taken by the provider from the salon's payout. 0 = none. */
  platformFeeMinor: number;
};

export type PaymentEvent = {
  reference: string;
  bookingId: string;
  amountMinor: number;
  currency: string;
  /** The connected account that received the money; null if the provider didn't say. */
  account: string | null;
};

/** What a verified webhook tells us: a payment, or (Stripe) a connected account's status change. */
export type WebhookEvent = ({ type: "payment" } & PaymentEvent) | { type: "account"; account: string; ready: boolean };

export interface PaymentProvider {
  readonly kind: ProviderKind;
  createLink(req: LinkRequest): Promise<{ url: string; reference: string }>;
  /** Verifies the signature and returns an event we act on, or null for others. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
}

/** PLATFORM_FEE_PERCENT of the amount, rounded down (default 0). */
export function platformFee(amountMinor: number): number {
  const pct = Number(process.env.PLATFORM_FEE_PERCENT ?? 0);
  return Number.isFinite(pct) && pct > 0 ? Math.floor((amountMinor * Math.min(pct, 50)) / 100) : 0;
}

export class SignatureError extends Error {}

/** Our reference carries the booking id: "bk_<bookingId>_<random>". */
export function newReference(bookingId: string): string {
  return `bk_${bookingId}_${randomBytes(6).toString("hex")}`;
}

export function bookingIdFromReference(reference: string): string | null {
  const m = /^bk_([A-Za-z0-9-]+)_[0-9a-f]{12}$/.exec(reference);
  return m ? m[1] : null;
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ───────── Paystack ─────────

/** x-paystack-signature = HMAC-SHA512(secret key, raw body), hex. */
export function verifyPaystackSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  return safeEqualHex(createHmac("sha512", secret).update(rawBody).digest("hex"), header);
}

export class PaystackProvider implements PaymentProvider {
  readonly kind = "PAYSTACK" as const;
  constructor(private readonly secret: string) {}

  async createLink(req: LinkRequest) {
    const reference = newReference(req.bookingId);
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Paystack requires an email; customers without one get a non-deliverable placeholder.
        email: req.customerEmail || `customer+${req.bookingId}@example.invalid`,
        amount: req.amountMinor,
        currency: req.currency,
        reference,
        callback_url: req.returnUrl,
        metadata: { bookingId: req.bookingId, description: req.description },
        // Settles to the salon's subaccount; the salon bears Paystack's fee, we take only ours.
        subaccount: req.account,
        bearer: "subaccount",
        ...(req.platformFeeMinor > 0 ? { transaction_charge: req.platformFeeMinor } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { authorization_url?: string } };
    if (!res.ok || !json.status || !json.data?.authorization_url) throw new Error(`Paystack error ${res.status}`);
    return { url: json.data.authorization_url, reference };
  }

  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null {
    if (!verifyPaystackSignature(rawBody, headers.get("x-paystack-signature"), this.secret)) throw new SignatureError();
    const event = JSON.parse(rawBody) as {
      event?: string;
      data?: { reference?: string; amount?: number; currency?: string; status?: string; subaccount?: { subaccount_code?: string } | null };
    };
    if (event.event !== "charge.success" || event.data?.status !== "success" || !event.data.reference) return null;
    const bookingId = bookingIdFromReference(event.data.reference);
    if (!bookingId) return null;
    return {
      type: "payment",
      reference: event.data.reference,
      bookingId,
      amountMinor: Number(event.data.amount),
      currency: String(event.data.currency).toUpperCase(),
      account: event.data.subaccount?.subaccount_code ?? null,
    };
  }
}

// ───────── Stripe ─────────

/** Stripe-Signature: "t=<unix>,v1=<hex>" where v1 = HMAC-SHA256(secret, `${t}.${body}`). 5-minute tolerance. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => safeEqualHex(expected, p.slice(3)));
}

export class StripeProvider implements PaymentProvider {
  readonly kind = "STRIPE" as const;
  /** `webhookSecrets`: the platform endpoint's and the Connect endpoint's (events from salons' accounts). */
  constructor(
    private readonly secret: string,
    private readonly webhookSecrets: string[],
  ) {}

  async createLink(req: LinkRequest) {
    const reference = newReference(req.bookingId);
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": req.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(req.amountMinor),
      "line_items[0][price_data][product_data][name]": req.description,
      "line_items[0][quantity]": "1",
      success_url: req.returnUrl,
      cancel_url: req.returnUrl,
      client_reference_id: reference,
      "metadata[bookingId]": req.bookingId,
    });
    if (req.customerEmail) form.set("customer_email", req.customerEmail);
    if (req.platformFeeMinor > 0) form.set("payment_intent_data[application_fee_amount]", String(req.platformFeeMinor));
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      // Direct charge on the salon's connected account.
      headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Account": req.account },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { url?: string };
    if (!res.ok || !json.url) throw new Error(`Stripe error ${res.status}`);
    return { url: json.url, reference };
  }

  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null {
    const signature = headers.get("stripe-signature");
    if (!this.webhookSecrets.some((s) => verifyStripeSignature(rawBody, signature, s))) throw new SignatureError();
    const event = JSON.parse(rawBody) as {
      type?: string;
      account?: string;
      data?: { object?: { id?: string; charges_enabled?: boolean; client_reference_id?: string; payment_status?: string; amount_total?: number; currency?: string } };
    };
    const o = event.data?.object;
    if (event.type === "account.updated" && o?.id) return { type: "account", account: o.id, ready: o.charges_enabled === true };
    if (event.type !== "checkout.session.completed" || o?.payment_status !== "paid" || !o.client_reference_id) return null;
    const bookingId = bookingIdFromReference(o.client_reference_id);
    if (!bookingId) return null;
    return {
      type: "payment",
      reference: o.client_reference_id,
      bookingId,
      amountMinor: Number(o.amount_total),
      currency: String(o.currency).toUpperCase(),
      account: event.account ?? null,
    };
  }
}

// ───────── Development ─────────

/** Local stand-in: links open /pay/fake/<reference>, where a button simulates the provider's webhook. */
export class FakePaymentProvider implements PaymentProvider {
  readonly kind = "FAKE" as const;
  constructor(private readonly appUrl: string) {}
  async createLink(req: LinkRequest) {
    const reference = newReference(req.bookingId);
    const q = new URLSearchParams({ amount: String(req.amountMinor), currency: req.currency, back: req.returnUrl });
    return { url: `${this.appUrl}/pay/fake/${reference}?${q}`, reference };
  }
  parseWebhook(): WebhookEvent | null {
    throw new SignatureError("The fake provider has no webhook");
  }
}

/** Production is live unless explicitly set to fake (e.g. a CI build); development is fake by default. */
export function paymentsMode(): "fake" | "live" {
  const mode = process.env.PAYMENTS_MODE ?? (process.env.NODE_ENV === "production" ? "live" : "fake");
  return mode === "fake" ? "fake" : "live";
}

/** The provider for a salon's choice. In fake mode every salon uses the fake provider. */
export function getPaymentProvider(kind: ProviderKind | null | undefined, appUrl: string): PaymentProvider | null {
  if (!kind) return null;
  if (paymentsMode() === "fake" || kind === "FAKE") return paymentsMode() === "fake" ? new FakePaymentProvider(appUrl) : null;
  return liveProvider(kind);
}

/** The real provider from server keys, or null when its keys aren't configured. */
export function liveProvider(kind: "PAYSTACK" | "STRIPE"): PaymentProvider | null {
  if (kind === "PAYSTACK") {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    return secret ? new PaystackProvider(secret) : null;
  }
  const secret = process.env.STRIPE_SECRET_KEY;
  const hooks = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((x): x is string => Boolean(x));
  return secret && hooks.length ? new StripeProvider(secret, hooks) : null;
}

type SalonPayments = { paymentProvider: ProviderKind | null; paymentProviderAccount: string | null; paymentAccountReady: boolean };

/** Online payments are on only once the salon's own account is connected and able to take charges. */
export function onlinePaymentsReady(salon: SalonPayments): boolean {
  return Boolean(salon.paymentProvider && salon.paymentProviderAccount && salon.paymentAccountReady);
}
