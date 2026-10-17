// Code-enforced guardrails for AI output (docs/ai-design.md §5). The prompt is never trusted.

export const ALLOWED_PLACEHOLDERS = [
  "first_name",
  "salon_name",
  "barber_name",
  "booking_link",
  "offer",
  "days_since_visit",
  "weeks_since_visit",
] as const;

export type DraftRules = {
  maxLength: number;
  /** A promotion was supplied, so {{offer}} may be used. */
  promotionProvided: boolean;
  requireBookingLink: boolean;
};

export type Violation =
  | `unknown_placeholder:${string}`
  | "malformed_placeholder"
  | "literal_offer"
  | "offer_without_promotion"
  | "too_long"
  | "missing_booking_link"
  | "blocked_term"
  | "contains_optout_footer"
  | "empty";

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

// Offers must come from {{offer}} (rendered from a Promotion record, BR-PR2).
const LITERAL_OFFER = [
  /\d+(\.\d+)?\s*(%|percent)/i,
  /[₦£$€]\s*\d/,
  /\b(NGN|GBP|USD|EUR|KES|GHS|ZAR)\s*\d/i,
  /\bdiscount(s|ed)?\b/i,
  /\b(coupon|promo\s*code|voucher)\b/i,
  /\bhalf[\s-]price\b/i,
  /\bfree\s+(cut|haircut|trim|shave|service|beard|treatment)\b/i,
  /\bon\s+(us|the\s+house)\b/i,
  /\b(buy\s+one|bogo)\b/i,
];

const BLOCKED_TERMS = [
  /\blast\s+chance\b/i,
  /\bact\s+now\b/i,
  /\bhurry\b/i,
  /!{3,}/,
  /\blimited\s+time\s+only\b/i,
  /\bguarantee(d)?\b/i,
  /\b(cure|cures|treats?)\b.*\b(hair\s*loss|baldness|dandruff)\b/i,
];

const OPTOUT_FOOTER = /\breply\s+stop\b/i;

export function checkDraft(text: string, rules: DraftRules): { ok: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, violations: ["empty"] };

  const used = [...trimmed.matchAll(PLACEHOLDER)].map((m) => m[1]);
  for (const name of used) {
    if (!(ALLOWED_PLACEHOLDERS as readonly string[]).includes(name)) {
      violations.push(`unknown_placeholder:${name}`);
    }
  }
  const withoutPlaceholders = trimmed.replace(PLACEHOLDER, "");
  if (/\{|\}/.test(withoutPlaceholders)) violations.push("malformed_placeholder");

  if (LITERAL_OFFER.some((re) => re.test(withoutPlaceholders))) violations.push("literal_offer");
  if (used.includes("offer") && !rules.promotionProvided) violations.push("offer_without_promotion");

  if (trimmed.length > rules.maxLength) violations.push("too_long");
  if (rules.requireBookingLink && !used.includes("booking_link")) violations.push("missing_booking_link");
  if (BLOCKED_TERMS.some((re) => re.test(withoutPlaceholders))) violations.push("blocked_term");
  if (OPTOUT_FOOTER.test(withoutPlaceholders)) violations.push("contains_optout_footer");

  return { ok: violations.length === 0, violations };
}

/**
 * Insight narration guardrail (ai-design.md A2): every number in the text must exist in the
 * input, after allowing for rounding and thousand separators. Returns numbers that aren't grounded.
 */
export function ungroundedNumbers(text: string, inputNumbers: readonly number[]): number[] {
  const found = [...text.matchAll(/-?\d[\d,]*(\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
  return found.filter(
    (n) =>
      !inputNumbers.some(
        (v) => v === n || Math.round(v) === n || Math.round(v * 10) / 10 === n || Math.abs(v) === Math.abs(n),
      ),
  );
}
