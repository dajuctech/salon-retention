import { describe, expect, it } from "vitest";
import { estimateCostUsd, retryDelayMs } from "./messaging-rules";
import { NO_OFFER_BIRTHDAY_LINE, isPromotionActive, offerLine } from "./offers";
import {
  MARKETING_FOOTER,
  PLATFORM_TEMPLATES,
  messageCategory,
  renderTemplate,
  templateFor,
  templateParams,
} from "./templates";
import { checkDraft } from "./ai-guardrails";
import { metaBodyProblem } from "./template-builder";

describe("templates (docs/whatsapp-templates.md)", () => {
  it("renders positional parameters in order", () => {
    const t = templateFor("REMINDER_2H")!;
    const params = templateParams(t.variables, {
      first_name: "Chuka",
      service_name: "haircut",
      barber_name: "Tunde",
      time_local: "11:30",
      manage_link: "https://x/b/t",
    });
    expect(renderTemplate(t.body, params)).toBe(
      "Hi Chuka, your haircut with Tunde is at 11:30 today. To change it: https://x/b/t See you soon.",
    );
  });

  it("refuses to render with a missing value instead of sending a broken message", () => {
    const t = templateFor("BOOKING_CONFIRMATION")!;
    expect(() => templateParams(t.variables, { first_name: "Tolu" })).toThrow(/Missing template value/);
    expect(() => renderTemplate("Hi {{1}} {{2}}", ["a"])).toThrow(/\{\{2\}\}/);
  });

  it("has matching placeholder counts and the opt-out footer on every marketing template", () => {
    for (const t of PLATFORM_TEMPLATES) {
      const positions = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(Math.max(...positions), t.name).toBe(t.variables.length);
      if (t.category === "MARKETING") expect(t.body.endsWith(MARKETING_FOOTER), t.name).toBe(true);
    }
  });

  // Meta rejects these automatically, so a broken template would cost days of re-approval.
  it("follows WhatsApp's template rules: no variable at the start or end, none side by side", () => {
    for (const t of PLATFORM_TEMPLATES) {
      expect(metaBodyProblem(t.body), t.name).toBeNull();
    }
  });

  it("BR-R11: no template promises a reply", () => {
    for (const t of PLATFORM_TEMPLATES) expect(t.body.toLowerCase()).not.toMatch(/reply (if|to change)/);
  });

  it("offers in templates come only from the offer_line variable (BR-PR2)", () => {
    for (const t of PLATFORM_TEMPLATES) {
      const literal = t.body.replace(/\{\{\d+\}\}/g, "").replace(MARKETING_FOOTER, "");
      expect(checkDraft(literal, { maxLength: 1000, promotionProvided: false, requireBookingLink: false }).violations, t.name).not.toContain(
        "literal_offer",
      );
    }
  });

  it("classifies message categories for consent checks", () => {
    expect(messageCategory("REMINDER_DAY_BEFORE")).toBe("UTILITY");
    expect(messageCategory("WINBACK")).toBe("MARKETING");
    expect(messageCategory("BIRTHDAY")).toBe("MARKETING");
    expect(messageCategory("STAFF_REPLY")).toBe("SESSION");
  });

  it("has all three win-back variants", () => {
    expect(["friendly", "short", "with_offer"].map((v) => templateFor("WINBACK", v)?.name)).toEqual([
      "winback_friendly_v1",
      "winback_short_v1",
      "winback_offer_v1",
    ]);
  });
});

describe("BR-PR2 offer lines from promotions", () => {
  const endsOn = new Date("2026-11-30T00:00:00Z");
  it("writes percentage, fixed and free-service offers", () => {
    expect(offerLine({ kind: "PERCENT", value: 10, serviceNames: ["Haircut"], endsOn }, "NGN")).toBe(
      "Enjoy 10% off any haircut until 30 Nov.",
    );
    expect(offerLine({ kind: "FIXED", value: 50_000, serviceNames: ["Haircut", "Kids cut"], endsOn }, "NGN")).toBe(
      "Enjoy ₦500 off haircut or kids cut until 30 Nov.",
    );
    expect(offerLine({ kind: "FREE_SERVICE", value: 0, serviceNames: ["Beard trim"], endsOn }, "NGN")).toBe(
      "Enjoy a free beard trim on your next visit until 30 Nov.",
    );
    expect(NO_OFFER_BIRTHDAY_LINE).not.toMatch(/free|off|%/i);
  });

  it("knows whether a promotion is running on a salon-local date", () => {
    const p = { active: true, startsOn: new Date("2026-11-01T00:00:00Z"), endsOn };
    expect(isPromotionActive(p, "2026-11-15")).toBe(true);
    expect(isPromotionActive(p, "2026-11-30")).toBe(true);
    expect(isPromotionActive(p, "2026-12-01")).toBe(false);
    expect(isPromotionActive({ ...p, active: false }, "2026-11-15")).toBe(false);
  });
});

describe("BR-R9 retry backoff", () => {
  it("waits 1m, 5m, 30m, then gives up after the 4th attempt", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([60_000, 300_000, 1_800_000]);
    expect(retryDelayMs(4)).toBeNull();
  });
});

describe("BR-PR3 cost estimate", () => {
  it("estimates per country with a default", () => {
    expect(estimateCostUsd(7, "marketing", "NG")).toBe(0.35);
    expect(estimateCostUsd(10, "utility", "ZZ")).toBe(0.2);
  });
});

describe("rendering punctuation (found in the browser review)", () => {
  it("doesn't double a full stop when a value already ends with one", () => {
    expect(renderTemplate("Hi, it's {{1}}. Book: {{2}}", ["Sharp & Co.", "x"])).toBe("Hi, it's Sharp & Co. Book: x");
    expect(renderTemplate("Hi, it's {{1}}. Book", ["Fresh Cuts"])).toBe("Hi, it's Fresh Cuts. Book");
    expect(renderTemplate("Wow {{1}}.", ["Yes!"])).toBe("Wow Yes!");
  });
});
