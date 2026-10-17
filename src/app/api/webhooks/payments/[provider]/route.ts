// Paystack / Stripe webhooks (BR-P3): the only way an online payment is recorded. Stripe also sends
// `account.updated` for salons' connected accounts (Connect endpoint), which turns payments on or off.
import { recordOnlinePayment, updateConnectedAccount } from "@/server/platform/payments";
import { liveProvider, SignatureError } from "@/server/payments/providers";

export async function POST(request: Request, { params }: RouteContext<"/api/webhooks/payments/[provider]">) {
  const { provider: name } = await params;
  const provider = name === "paystack" ? liveProvider("PAYSTACK") : name === "stripe" ? liveProvider("STRIPE") : null;
  if (!provider) return new Response("Not configured", { status: 404 });
  const raw = await request.text();
  let event;
  try {
    event = provider.parseWebhook(raw, request.headers);
  } catch (err) {
    if (err instanceof SignatureError) return new Response("Invalid signature", { status: 401 });
    return new Response("Bad request", { status: 400 });
  }
  if (event?.type === "payment") await recordOnlinePayment(provider.kind, event);
  if (event?.type === "account") await updateConnectedAccount(provider.kind, event.account, event.ready);
  return Response.json({ ok: true });
}
