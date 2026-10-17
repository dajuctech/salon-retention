// Money is integer minor units + ISO-4217 currency (BR-M1, ADR-0008).

export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** minorUnitDigits(currency));
}

/** Formats without decimals when the amount is whole, e.g. ₦3,000 or £12.50. */
export function formatMoney(amountMinor: number, currency: string, locale = "en"): string {
  if (!Number.isInteger(amountMinor)) throw new Error("amountMinor must be an integer");
  const digits = minorUnitDigits(currency);
  const major = amountMinor / 10 ** digits;
  const whole = amountMinor % 10 ** digits === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(major);
}
