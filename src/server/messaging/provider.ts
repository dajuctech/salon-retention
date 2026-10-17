// WhatsApp provider interface (ADR-0005). The console provider is used in development and tests.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type SendResult =
  | { ok: true; providerMessageId: string; delivered?: boolean }
  | { ok: false; retryable: boolean; reason: string };

export type TemplateSend = { to: string; templateName: string; language: string; params: string[]; text: string };

export interface MessagingProvider {
  readonly name: string;
  sendTemplate(msg: TemplateSend): Promise<SendResult>;
  /** Free-form message; only valid within 24 hours of the customer's last message. */
  sendText(msg: { to: string; text: string }): Promise<SendResult>;
}

/**
 * Logs instead of sending. Numbers ending in 0000 simulate "not on WhatsApp" so the failure
 * path (Needs attention → Fix number) can be tried locally.
 */
export class ConsoleProvider implements MessagingProvider {
  readonly name = "console";

  private result(to: string): SendResult {
    if (to.endsWith("0000")) return { ok: false, retryable: false, reason: "not_on_whatsapp" };
    return { ok: true, providerMessageId: `console_${randomUUID()}`, delivered: true };
  }

  async sendTemplate(msg: TemplateSend): Promise<SendResult> {
    if (process.env.NODE_ENV !== "test") console.info(`[whatsapp:console] → ${msg.to} (${msg.templateName}) ${msg.text}`);
    return this.result(msg.to);
  }

  async sendText(msg: { to: string; text: string }): Promise<SendResult> {
    if (process.env.NODE_ENV !== "test") console.info(`[whatsapp:console] → ${msg.to} (text) ${msg.text}`);
    return this.result(msg.to);
  }
}

/** Meta WhatsApp Cloud API. Error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes */
export class MetaCloudProvider implements MessagingProvider {
  readonly name = "meta";
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly graphVersion = process.env.META_GRAPH_VERSION ?? "v21.0",
  ) {}

  private async post(body: object): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: false, retryable: true, reason: "network_error" };
    }
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { code?: number; message?: string };
    };
    if (res.ok && json.messages?.[0]?.id) return { ok: true, providerMessageId: json.messages[0].id };
    return metaError(res.status, json.error?.code);
  }

  sendTemplate(msg: TemplateSend): Promise<SendResult> {
    return this.post({
      to: msg.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: msg.templateName,
        language: { code: msg.language },
        components: [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }],
      },
    });
  }

  sendText(msg: { to: string; text: string }): Promise<SendResult> {
    return this.post({ to: msg.to.replace(/^\+/, ""), type: "text", text: { body: msg.text } });
  }
}

export function metaError(status: number, code: number | undefined): SendResult {
  if (code === 131026) return { ok: false, retryable: false, reason: "not_on_whatsapp" };
  if (code === 131047) return { ok: false, retryable: false, reason: "outside_24h_window" };
  if (code === 132001 || code === 132000) return { ok: false, retryable: false, reason: "template_problem" };
  if (status === 429 || code === 130429 || code === 131056 || status >= 500) {
    return { ok: false, retryable: true, reason: `provider_busy_${code ?? status}` };
  }
  return { ok: false, retryable: false, reason: `provider_error_${code ?? status}` };
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

let provider: MessagingProvider | undefined;

export function getProvider(): MessagingProvider {
  if (provider) return provider;
  const kind = process.env.MESSAGING_PROVIDER ?? "console";
  if (kind === "meta") {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) throw new Error("META_WHATSAPP_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID not set");
    provider = new MetaCloudProvider(token, phoneId);
  } else if (kind === "console") {
    provider = new ConsoleProvider();
  } else {
    throw new Error(`MESSAGING_PROVIDER=${kind} is not supported yet`);
  }
  return provider;
}

/** For tests: swap in a fake provider. */
export function setProviderForTests(p: MessagingProvider | undefined) {
  provider = p;
}
