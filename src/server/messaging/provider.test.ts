import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleProvider, MetaCloudProvider, metaError, verifyMetaSignature } from "./provider";

describe("Meta webhook signature (security-privacy.md)", () => {
  const body = '{"entry":[]}';
  const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
  it("accepts the correct signature and rejects anything else", () => {
    expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(`${body} `, sig, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "s3cret")).toBe(false);
  });
});

describe("Meta error mapping (BR-R9)", () => {
  it("does not retry permanent failures", () => {
    expect(metaError(400, 131026)).toEqual({ ok: false, retryable: false, reason: "not_on_whatsapp" });
    expect(metaError(400, 131047)).toMatchObject({ retryable: false, reason: "outside_24h_window" });
    expect(metaError(400, 132001)).toMatchObject({ retryable: false });
  });
  it("retries rate limits and server errors", () => {
    expect(metaError(429, undefined)).toMatchObject({ retryable: true });
    expect(metaError(400, 130429)).toMatchObject({ retryable: true });
    expect(metaError(503, undefined)).toMatchObject({ retryable: true });
  });
});

describe("MetaCloudProvider request shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a template with ordered body parameters and no '+' in the number", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const p = new MetaCloudProvider("tok", "123", "v21.0");
    const result = await p.sendTemplate({ to: "+2348031234567", templateName: "reminder_2h_v1", language: "en", params: ["A", "B"], text: "" });
    expect(result).toEqual({ ok: true, providerMessageId: "wamid.1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/123/messages");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      to: "2348031234567",
      type: "template",
      template: {
        name: "reminder_2h_v1",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }],
      },
    });
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("treats network failures as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const result = await new MetaCloudProvider("t", "1").sendText({ to: "+1", text: "hi" });
    expect(result).toEqual({ ok: false, retryable: true, reason: "network_error" });
  });
});

describe("ConsoleProvider", () => {
  it("simulates 'not on WhatsApp' for numbers ending in 0000", async () => {
    const p = new ConsoleProvider();
    expect(await p.sendText({ to: "+2348030000000", text: "x" })).toMatchObject({ ok: false, reason: "not_on_whatsapp" });
    expect(await p.sendText({ to: "+2348031234567", text: "x" })).toMatchObject({ ok: true, delivered: true });
  });
});
