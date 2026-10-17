// Phone normalisation to E.164 (BR-I1, ADR-0008).
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type PhoneResult = { ok: true; e164: string } | { ok: false; reason: "invalid" };

/** "+2348025550147" → "+234 802 555 0147". Falls back to the raw value. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

export function normalizePhone(raw: string, defaultCountry: string): PhoneResult {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry.toUpperCase() as CountryCode);
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
  return { ok: true, e164: parsed.number };
}
