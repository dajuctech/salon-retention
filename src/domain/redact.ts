// NFR-OBS: logs never contain personal data. Fields with personal names are replaced, and phone
// numbers, emails and bank account numbers inside free text are masked.

const SENSITIVE_KEY = /(phone|email|name|text|body|notes?|token|password|secret|cookie|authorization|account_?number|address)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s-]{7,}\d/g;

export const REDACTED = "[redacted]";

/** Masks emails and long digit runs (phones, account numbers) in a string. */
export function maskText(s: string): string {
  return s.replace(EMAIL, "[email]").replace(PHONE, "[number]");
}

/** A copy of `value` safe to log. Ids, counts, statuses and dates pass through unchanged. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[deep]";
  if (typeof value === "string") return maskText(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: maskText(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) && !/id$/i.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}
