import { describe, expect, it } from "vitest";
import { buildTemplate, metaBodyProblem, templateToWording } from "./template-builder";
import { PLATFORM_TEMPLATES, renderTemplate, templateParams } from "./templates";

describe("US-22 AC5 template builder", () => {
  it("numbers placeholders in order, reuses repeats and maps {{offer}} to the offer line", () => {
    const t = buildTemplate("Hi {{first_name}}! {{offer}} See {{barber_name}}, {{first_name}}: {{booking_link}}", { marketing: true });
    expect(t.body).toBe("Hi {{1}}! {{2}} See {{3}}, {{1}}: {{4}} Reply STOP to opt out.");
    expect(t.variables).toEqual(["first_name", "offer_line", "barber_name", "booking_link"]);
  });

  it("never doubles the opt-out footer and leaves utility templates without it", () => {
    expect(buildTemplate("Hi {{first_name}} {{booking_link}} Reply STOP to opt out.", { marketing: true }).body).toBe(
      "Hi {{1}} {{2}} Reply STOP to opt out.",
    );
    expect(buildTemplate("Hi {{first_name}}", { marketing: false }).body).toBe("Hi {{1}}");
  });

  it("spots wording WhatsApp would reject: a variable first, last, or two side by side", () => {
    expect(metaBodyProblem("{{1}}, your cut is due. Reply STOP to opt out.")).toBe("starts_with_variable");
    expect(metaBodyProblem("To change it: {{1}}")).toBe("ends_with_variable");
    expect(metaBodyProblem("Hi {{1}}. {{2}} {{3}} Reply STOP to opt out.")).toBe("adjacent_variables");
    expect(metaBodyProblem("Hi {{1}}. {{2}} Book: {{3}} Reply STOP to opt out.")).toBeNull();
  });

  it("round-trips the platform win-back templates", () => {
    for (const t of PLATFORM_TEMPLATES.filter((x) => x.type === "WINBACK")) {
      const back = buildTemplate(templateToWording(t.body, t.variables), { marketing: true });
      const values = { first_name: "A", salon_name: "B", weeks_since_visit: "5", barber_name: "C", booking_link: "D", offer_line: "E" };
      expect(renderTemplate(back.body, templateParams(back.variables, values))).toBe(renderTemplate(t.body, templateParams(t.variables, values)));
    }
  });
});
