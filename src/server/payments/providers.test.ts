import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PaystackProvider,
  SignatureError,
  StripeProvider,
  bookingIdFromReference,
  newReference,
  onlinePaymentsReady,
  platformFee,
  verifyPaystackSignature,
  verifyStripeSignature,
} from "./providers";

describe("references", () => {
  it("round-trips the booking id and rejects anything else", () => {
    const ref = newReference("cmabc123");
    expect(bookingIdFromReference(ref)).toBe("cmabc123");
    expect(bookingIdFromReference("bk_x_short")).toBeNull();
    expect(bookingIdFromReference("evil")).toBeNull();
  });
});

describe("BR-P3 Paystack webhooks", () => {
  const secret = "sk_test_x";
  const body = JSON.stringify({
    event: "charge.success",
    data: { reference: newReference("bk1"), amount: 300000, currency: "NGN", status: "success", subaccount: { subaccount_code: "ACCT_salon1" } },
  });
  const sig = createHmac("sha512", secret).update(body).digest("hex");

  it("verifies the signature over the raw body", () => {
    expect(verifyPaystackSignature(body, sig, secret)).toBe(true);
    expect(verifyPaystackSignature(`${body} `, sig, secret)).toBe(false);
    expect(verifyPaystackSignature(body, null, secret)).toBe(false);
  });

  it("returns successful charges and throws on a forged one", () => {
    const p = new PaystackProvider(secret);
    expect(p.parseWebhook(body, new Headers({ "x-paystack-signature": sig }))).toMatchObject({ type: "payment", bookingId: "bk1", amountMinor: 300000, currency: "NGN", account: "ACCT_salon1" });
    expect(() => p.parseWebhook(body, new Headers({ "x-paystack-signature": "00" }))).toThrow(SignatureError);
  });

  it("ignores events that aren't a successful charge", () => {
    const other = JSON.stringify({ event: "charge.failed", data: { reference: newReference("bk1"), status: "failed" } });
    const s = createHmac("sha512", secret).update(other).digest("hex");
    expect(new PaystackProvider(secret).parseWebhook(other, new Headers({ "x-paystack-signature": s }))).toBeNull();
  });
});

describe("BR-P3 Stripe webhooks", () => {
  const secret = "whsec_x";
  const now = Date.parse("2026-10-16T10:00:00Z");
  const t = Math.floor(now / 1000);
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: newReference("bk2"), payment_status: "paid", amount_total: 2000, currency: "gbp" } },
  });
  const header = (ts: number, b = body) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${b}`).digest("hex")}`;

  it("verifies signature and timestamp tolerance", () => {
    expect(verifyStripeSignature(body, header(t), secret, now)).toBe(true);
    expect(verifyStripeSignature(body, header(t - 600), secret, now)).toBe(false); // replayed
    expect(verifyStripeSignature(`${body}x`, header(t), secret, now)).toBe(false);
  });

  it("returns paid checkout sessions with an upper-case currency", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const p = new StripeProvider("sk_test", [secret]);
    expect(p.parseWebhook(body, new Headers({ "stripe-signature": header(t) }))).toMatchObject({ type: "payment", bookingId: "bk2", amountMinor: 2000, currency: "GBP" });
    vi.useRealTimers();
  });

  it("accepts the Connect endpoint's secret and reports which salon account was paid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const connectSecret = "whsec_connect";
    const b = JSON.stringify({ ...JSON.parse(body), account: "acct_salon2" });
    const sig = `t=${t},v1=${createHmac("sha256", connectSecret).update(`${t}.${b}`).digest("hex")}`;
    const p = new StripeProvider("sk_test", [secret, connectSecret]);
    expect(p.parseWebhook(b, new Headers({ "stripe-signature": sig }))).toMatchObject({ type: "payment", account: "acct_salon2" });
    expect(() => new StripeProvider("sk_test", [secret]).parseWebhook(b, new Headers({ "stripe-signature": sig }))).toThrow(SignatureError);
    vi.useRealTimers();
  });

  it("turns account.updated into an account status change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const b = JSON.stringify({ type: "account.updated", account: "acct_salon2", data: { object: { id: "acct_salon2", charges_enabled: true } } });
    const p = new StripeProvider("sk_test", [secret]);
    expect(p.parseWebhook(b, new Headers({ "stripe-signature": header(t, b) }))).toEqual({ type: "account", account: "acct_salon2", ready: true });
    vi.useRealTimers();
  });
});

describe("Paystack link creation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends amount in minor units with our reference and returns the checkout URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await new PaystackProvider("sk").createLink({ bookingId: "bk9", amountMinor: 450000, currency: "NGN", description: "Haircut", returnUrl: "https://x/b/t", account: "ACCT_s", platformFeeMinor: 0 });
    expect(r.url).toBe("https://checkout.paystack.com/abc");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ amount: 450000, currency: "NGN", reference: r.reference, callback_url: "https://x/b/t" });
    expect(sent.email).toMatch(/@example\.invalid$/);
  });

  it("ADR-0006 settles to the salon's subaccount, which bears Paystack's fee; our fee is per charge", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } })));
    vi.stubGlobal("fetch", fetchMock);
    const base = { bookingId: "bk9", amountMinor: 450000, currency: "NGN", description: "Haircut", returnUrl: "https://x/b/t", account: "ACCT_s" };
    await new PaystackProvider("sk").createLink({ ...base, platformFeeMinor: 0 });
    await new PaystackProvider("sk").createLink({ ...base, platformFeeMinor: 4500 });
    const [noFee, withFee] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(noFee).toMatchObject({ subaccount: "ACCT_s", bearer: "subaccount" });
    expect(noFee).not.toHaveProperty("transaction_charge");
    expect(withFee).toMatchObject({ subaccount: "ACCT_s", transaction_charge: 4500 });
  });
});

describe("Stripe link creation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("ADR-0006 creates the checkout on the salon's connected account, with our fee if any", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "https://checkout.stripe.com/c" })));
    vi.stubGlobal("fetch", fetchMock);
    await new StripeProvider("sk", ["wh"]).createLink({ bookingId: "bk9", amountMinor: 2500, currency: "GBP", description: "Fade", returnUrl: "https://x", account: "acct_s", platformFeeMinor: 125 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Stripe-Account"]).toBe("acct_s");
    expect((init.body as URLSearchParams).get("payment_intent_data[application_fee_amount]")).toBe("125");
    expect((init.body as URLSearchParams).get("line_items[0][price_data][currency]")).toBe("gbp");
  });
});

describe("platform fee and readiness", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("takes PLATFORM_FEE_PERCENT rounded down, none by default, never more than half", () => {
    expect(platformFee(300_000)).toBe(0);
    vi.stubEnv("PLATFORM_FEE_PERCENT", "1.5");
    expect(platformFee(300_001)).toBe(4500);
    vi.stubEnv("PLATFORM_FEE_PERCENT", "90");
    expect(platformFee(1000)).toBe(500);
    vi.stubEnv("PLATFORM_FEE_PERCENT", "nonsense");
    expect(platformFee(1000)).toBe(0);
  });

  it("needs a provider, a connected account, and that account ready", () => {
    expect(onlinePaymentsReady({ paymentProvider: "PAYSTACK", paymentProviderAccount: "ACCT_x", paymentAccountReady: true })).toBe(true);
    expect(onlinePaymentsReady({ paymentProvider: "PAYSTACK", paymentProviderAccount: null, paymentAccountReady: false })).toBe(false);
    expect(onlinePaymentsReady({ paymentProvider: "STRIPE", paymentProviderAccount: "acct_x", paymentAccountReady: false })).toBe(false);
    expect(onlinePaymentsReady({ paymentProvider: null, paymentProviderAccount: "acct_x", paymentAccountReady: true })).toBe(false);
  });
});
