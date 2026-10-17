// WhatsApp templates (docs/whatsapp-templates.md). Bodies use Meta's positional {{1}} syntax;
// `variables` names the value that fills each position, in order.

export type MessageType =
  | "BOOKING_CONFIRMATION"
  | "REMINDER_DAY_BEFORE"
  | "REMINDER_2H"
  | "WINBACK"
  | "BIRTHDAY"
  | "PROMOTION"
  | "OPTOUT_CONFIRMATION"
  | "STAFF_REPLY";

export type TemplateCategory = "UTILITY" | "MARKETING";

/** Session messages are free-form replies inside the 24-hour window, not templates. */
export const SESSION_TYPES: readonly MessageType[] = ["OPTOUT_CONFIRMATION", "STAFF_REPLY"];

export function messageCategory(type: MessageType): TemplateCategory | "SESSION" {
  if (SESSION_TYPES.includes(type)) return "SESSION";
  return type === "WINBACK" || type === "BIRTHDAY" || type === "PROMOTION" ? "MARKETING" : "UTILITY";
}

export const MARKETING_FOOTER = "Reply STOP to opt out.";

export type TemplateDef = {
  name: string;
  type: MessageType;
  category: TemplateCategory;
  variant?: "friendly" | "short" | "with_offer";
  body: string;
  variables: string[];
};

export const PLATFORM_TEMPLATES: readonly TemplateDef[] = [
  {
    name: "booking_confirmation_v1",
    type: "BOOKING_CONFIRMATION",
    category: "UTILITY",
    body: "Hi {{1}}, your {{2}} at {{3}} is booked for {{4}} with {{5}}. Booking ref {{6}}. To change or cancel: {{7}}",
    variables: ["first_name", "service_name", "salon_name", "date_time_local", "barber_name", "booking_ref", "manage_link"],
  },
  {
    name: "reminder_day_before_v1",
    type: "REMINDER_DAY_BEFORE",
    category: "UTILITY",
    body: "Hi {{1}}, your {{2}} with {{3}} is tomorrow at {{4}}. To change it: {{5}}",
    variables: ["first_name", "service_name", "barber_name", "time_local", "manage_link"],
  },
  {
    name: "reminder_2h_v1",
    type: "REMINDER_2H",
    category: "UTILITY",
    body: "Hi {{1}}, your {{2}} with {{3}} is at {{4}} today. See you soon. To change it: {{5}}",
    variables: ["first_name", "service_name", "barber_name", "time_local", "manage_link"],
  },
  {
    name: "winback_friendly_v1",
    type: "WINBACK",
    category: "MARKETING",
    variant: "friendly",
    body: `Hi {{1}}, it's {{2}}. It's been {{3}} weeks since your last cut with {{4}}. Want us to hold a slot for you this week? Book in under a minute: {{5}} ${MARKETING_FOOTER}`,
    variables: ["first_name", "salon_name", "weeks_since_visit", "barber_name", "booking_link"],
  },
  {
    name: "winback_short_v1",
    type: "WINBACK",
    category: "MARKETING",
    variant: "short",
    body: `Hi {{1}}, ready for a fresh cut? Book with {{2}} at {{3}}: {{4}} ${MARKETING_FOOTER}`,
    variables: ["first_name", "barber_name", "salon_name", "booking_link"],
  },
  {
    name: "winback_offer_v1",
    type: "WINBACK",
    category: "MARKETING",
    variant: "with_offer",
    body: `Hi {{1}}, we've missed you at {{2}}. {{3}} Book: {{4}} ${MARKETING_FOOTER}`,
    variables: ["first_name", "salon_name", "offer_line", "booking_link"],
  },
  {
    // The owner-approved campaign text fills {{1}} (src/server/staff/campaigns.ts).
    name: "promotion_generic_v1",
    type: "PROMOTION",
    category: "MARKETING",
    body: `{{1}} Book: {{2}} ${MARKETING_FOOTER}`,
    variables: ["promotion_body", "booking_link"],
  },
  {
    name: "birthday_v1",
    type: "BIRTHDAY",
    category: "MARKETING",
    body: `Happy birthday {{1}}! 🎉 Everyone at {{2}} wishes you a great day. {{3}} {{4}} ${MARKETING_FOOTER}`,
    variables: ["first_name", "salon_name", "offer_line", "booking_link"],
  },
];

export function templateFor(type: MessageType, variant?: string): TemplateDef | undefined {
  return PLATFORM_TEMPLATES.find((t) => t.type === type && (variant === undefined || t.variant === variant));
}

/** Ordered parameters for the provider, from named values. Throws if a value is missing. */
export function templateParams(variables: readonly string[], values: Record<string, string>): string[] {
  return variables.map((name) => {
    const v = values[name];
    if (v === undefined || v === "") throw new Error(`Missing template value: ${name}`);
    return v;
  });
}

/** The text the customer will see, for the message log and previews. */
export function renderTemplate(body: string, params: readonly string[]): string {
  // "it's {{2}}." with a value ending in "." (e.g. "Sharp & Co.") must not become "Co..".
  return body.replace(/\{\{(\d+)\}\}(\.?)/g, (_, n: string, dot: string) => {
    const v = params[Number(n) - 1];
    if (v === undefined) throw new Error(`Missing template parameter {{${n}}}`);
    return dot && /[.!?]$/.test(v) ? v : v + dot;
  });
}
