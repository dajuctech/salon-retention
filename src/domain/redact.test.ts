import { describe, expect, it } from "vitest";
import { REDACTED, maskText, redact } from "./redact";

describe("NFR-OBS log redaction", () => {
  it("masks phones, emails and account numbers in free text", () => {
    expect(maskText("Send to +234 803 555 0157 or ada@example.com, acct 0123456789")).toBe("Send to [number] or [email], acct [number]");
  });

  it("replaces personal fields but keeps ids, counts and statuses", () => {
    expect(
      redact({ customerId: "c1", name: "Ada Obi", phoneE164: "+2348035550157", status: "SENT", attempts: 2, nested: { notes: "likes fades", bookingId: "b1" } }),
    ).toEqual({ customerId: "c1", name: REDACTED, phoneE164: REDACTED, status: "SENT", attempts: 2, nested: { notes: REDACTED, bookingId: "b1" } });
  });

  it("logs errors by name and masked message, and stops at deep or long values", () => {
    expect(redact(new Error("no WhatsApp for +2348035550000"))).toEqual({ name: "Error", message: "no WhatsApp for [number]" });
    expect((redact(Array.from({ length: 50 }, (_, i) => i)) as unknown[]).length).toBe(20);
    expect(redact({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toEqual({ a: { b: { c: { d: { e: { f: "[deep]" } } } } } });
    expect(redact(new Date("2026-10-17T00:00:00Z"))).toBe("2026-10-17T00:00:00.000Z");
  });
});
