// Meta WhatsApp webhook (ADR-0005). GET = subscription check; POST = messages and statuses.
// Every POST is signature-checked before anything is parsed (security-privacy.md).
import { normalizePhone } from "@/domain/phone";
import { verifyMetaSignature } from "@/server/messaging/provider";
import { applyStatus, handleInbound } from "@/server/platform/inbound";

export function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type MetaPayload = {
  entry?: {
    changes?: {
      value?: {
        messages?: { from: string; id: string; timestamp: string; type: string; text?: { body: string } }[];
        statuses?: { id: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: string; errors?: { code: number }[] }[];
      };
    }[];
  }[];
};

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  const raw = await request.text();
  if (!secret || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }
  const payload = JSON.parse(raw) as MetaPayload;
  for (const change of payload.entry?.flatMap((e) => e.changes ?? []) ?? []) {
    for (const s of change.value?.statuses ?? []) {
      await applyStatus(s.id, s.status, new Date(Number(s.timestamp) * 1000), s.errors?.[0] ? `provider_error_${s.errors[0].code}` : undefined);
    }
    for (const m of change.value?.messages ?? []) {
      const phone = normalizePhone(`+${m.from}`, "NG");
      if (!phone.ok) continue;
      await handleInbound({
        fromE164: phone.e164,
        text: m.type === "text" ? (m.text?.body ?? "") : `[${m.type} message]`,
        providerMessageId: m.id,
        receivedAt: new Date(Number(m.timestamp) * 1000),
      });
    }
  }
  return Response.json({ ok: true });
}
