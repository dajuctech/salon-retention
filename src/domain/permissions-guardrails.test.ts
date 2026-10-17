import { describe, expect, it } from "vitest";
import { checkDraft, ungroundedNumbers } from "./ai-guardrails";
import { can } from "./permissions";

describe("permissions matrix (docs/permissions.md)", () => {
  it("hides customer phone numbers from barbers", () => {
    expect(can("barber", "customers.viewPhone")).toBe(false);
    expect(can("barber", "customers.viewPhone", true)).toBe(false);
    expect(can("receptionist", "customers.viewPhone")).toBe(true);
  });

  it("limits barbers to their own bookings", () => {
    expect(can("barber", "bookings.complete")).toBe(false);
    expect(can("barber", "bookings.complete", true)).toBe(true);
  });

  it("makes approvals, exports and AI owner-only", () => {
    for (const cap of ["winback.approve", "promotions.approve", "customers.exportDelete", "ai.copyAssistant"] as const) {
      expect(can("owner", cap)).toBe(true);
      expect(can("receptionist", cap)).toBe(false);
      expect(can("barber", cap, true)).toBe(false);
    }
  });
});

const rules = { maxLength: 320, promotionProvided: false, requireBookingLink: true };

describe("AI draft guardrails (ai-design.md §5)", () => {
  it("accepts a clean draft that only uses allowed placeholders", () => {
    const text =
      "Hi {{first_name}}, it's {{salon_name}}. It's been a few weeks since your last cut with {{barber_name}}. Book in under a minute: {{booking_link}}";
    expect(checkDraft(text, rules)).toEqual({ ok: true, violations: [] });
  });

  it("blocks the design's invented birthday offer ('a fresh cut on us')", () => {
    const text = "Happy birthday {{first_name}}! Come in this week and enjoy a fresh cut on us. {{booking_link}}";
    expect(checkDraft(text, rules).violations).toContain("literal_offer");
  });

  it.each(["Get 10% off this week", "Only ₦2,000 today", "Use promo code CUT10", "Free haircut for you", "Big discount!"])(
    "blocks literal offers: %s",
    (offer) => {
      expect(checkDraft(`${offer} {{booking_link}}`, rules).violations).toContain("literal_offer");
    },
  );

  it("does not flag ordinary words like 'feel free' or 'drop off'", () => {
    expect(checkDraft("Feel free to drop off anytime {{booking_link}}", rules).ok).toBe(true);
  });

  it("allows {{offer}} only when a promotion was supplied", () => {
    const text = "We've missed you. {{offer}} {{booking_link}}";
    expect(checkDraft(text, rules).violations).toContain("offer_without_promotion");
    expect(checkDraft(text, { ...rules, promotionProvided: true }).ok).toBe(true);
  });

  it("rejects unknown or malformed placeholders", () => {
    expect(checkDraft("Hi {{phone}} {{booking_link}}", rules).violations).toContain("unknown_placeholder:phone");
    expect(checkDraft("Hi {first_name} {{booking_link}}", rules).violations).toContain("malformed_placeholder");
  });

  it("enforces length, booking link, pressure tactics and the code-owned opt-out footer", () => {
    expect(checkDraft(`${"a".repeat(321)}{{booking_link}}`, rules).violations).toContain("too_long");
    expect(checkDraft("Hi {{first_name}}", rules).violations).toContain("missing_booking_link");
    expect(checkDraft("Last chance!!! {{booking_link}}", rules).violations).toContain("blocked_term");
    expect(checkDraft("Hi {{booking_link}} Reply STOP to opt out.", rules).violations).toContain(
      "contains_optout_footer",
    );
    expect(checkDraft("   ", rules)).toEqual({ ok: false, violations: ["empty"] });
  });
});

describe("insight narration number grounding (ai-design.md A2)", () => {
  const input = [312, 64.3, 5.8, 1_140_000, 8];
  it("accepts numbers present in the input, allowing rounding and separators", () => {
    expect(ungroundedNumbers("312 bookings, 64% returned, no-shows 5.8%, revenue 1,140,000, up 8%.", input)).toEqual(
      [],
    );
  });
  it("flags invented numbers", () => {
    expect(ungroundedNumbers("Bookings rose 12% to 340.", input)).toEqual([12, 340]);
  });
});
