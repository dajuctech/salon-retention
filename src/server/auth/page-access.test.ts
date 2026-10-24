// The proxy's 404 rules must match what each page checks for itself, or the two drift apart.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ruleFor, STAFF_PAGE_RULES } from "./page-access";

const PAGES: Record<string, string> = {
  "/app/customers/x/edit": "src/app/app/customers/[id]/edit/page.tsx",
  "/app/customers/x": "src/app/app/customers/[id]/page.tsx",
  "/app/bookings/x": "src/app/app/bookings/[id]/page.tsx",
  "/app/whatsapp/inbox/x": "src/app/app/whatsapp/inbox/[id]/page.tsx",
  "/app/whatsapp/offers": "src/app/app/whatsapp/offers/page.tsx",
  "/app/whatsapp/approve": "src/app/app/whatsapp/approve/page.tsx",
  "/app/whatsapp/templates": "src/app/app/whatsapp/templates/page.tsx",
  "/app/whatsapp": "src/app/app/whatsapp/page.tsx",
  "/app/reports": "src/app/app/reports/page.tsx",
  "/app/settings": "src/app/app/settings/page.tsx",
};

describe("staff page rules (proxy 404s)", () => {
  it("has one rule per gated page", () => {
    expect(Object.keys(PAGES)).toHaveLength(STAFF_PAGE_RULES.length);
  });

  for (const [path, file] of Object.entries(PAGES)) {
    it(`${path} matches the guard in its page`, () => {
      const hit = ruleFor(path);
      expect(hit).not.toBeNull();
      const source = readFileSync(file, "utf8");
      for (const c of hit!.rule.capabilities ?? []) expect(source).toContain(`requirePage("${c}")`);
      if (hit!.rule.roles) expect(source).toContain(`requireRole(${hit!.rule.roles.map((r) => `"${r}"`).join(", ")})`);
      if (hit!.rule.record) {
        expect(hit!.id).toBe("x");
        expect(source).toContain(`requireRecord("${hit!.rule.record}"`);
      }
    });
  }

  it("leaves ungated pages alone", () => {
    for (const p of ["/app", "/app/calendar", "/app/customers", "/app/customers/new", "/app/bookings/new", "/app/payments", "/app/more", "/app/walk-in"]) {
      expect(ruleFor(p), p).toBeNull();
    }
  });

  // A record rule like /app/bookings/<id> must not swallow a fixed page such as /app/bookings/new.
  it("never treats a fixed page as a record", () => {
    const fixed = readdirSync("src/app/app", { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith("page.tsx") && !f.includes("["))
      .map((f) => `/app/${f}`.replace(/\/?page\.tsx$/, ""));
    expect(fixed).toContain("/app/bookings/new");
    for (const route of fixed) expect(ruleFor(route)?.rule.record, route).toBeUndefined();
  });
});
