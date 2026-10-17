import { describe, expect, it } from "vitest";
import { COUNTRIES, STARTER_SERVICES, starterPrice } from "./countries";
import { isValidSlug, slugify, uniqueSlug } from "./slug";

describe("US-01 booking link slugs", () => {
  it("makes readable slugs", () => {
    expect(slugify("Sharp & Co.")).toBe("sharp-and-co");
    expect(slugify("  Café Fresh Cutz!! ")).toBe("cafe-fresh-cutz");
  });

  it("never lets a salon take an app route", () => {
    expect(isValidSlug("app")).toBe(false);
    expect(isValidSlug("login")).toBe(false);
    expect(isValidSlug("sharp-and-co")).toBe(true);
    expect(isValidSlug("-bad")).toBe(false);
  });

  it("picks the next free slug", async () => {
    const taken = new Set(["sharp-and-co", "sharp-and-co-2"]);
    expect(await uniqueSlug("Sharp & Co.", async (s) => taken.has(s))).toBe("sharp-and-co-3");
    expect(await uniqueSlug("App", async () => false)).toBe("app-salon");
    expect(await uniqueSlug("!!", async () => false)).toBe("salon-salon");
  });
});

describe("countries", () => {
  it("has a timezone and currency Intl understands for every market", () => {
    for (const c of Object.values(COUNTRIES)) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: c.timezone })).not.toThrow();
      expect(() => new Intl.NumberFormat("en", { style: "currency", currency: c.currency })).not.toThrow();
    }
  });
  it("has starter prices for every currency (design p12 for NGN)", () => {
    expect(STARTER_SERVICES.map((_, i) => starterPrice("NGN", i))).toEqual([3000, 4500, 2000, 2500]);
    for (const c of Object.values(COUNTRIES)) expect(starterPrice(c.currency, 0)).toBeGreaterThan(0);
  });
});
