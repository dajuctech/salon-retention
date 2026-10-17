// Supported markets (PRD: multi-market). Each salon still stores its own timezone and currency.

export type CountryConfig = { name: string; timezone: string; currency: string; samplePhone: string };

export const COUNTRIES: Record<string, CountryConfig> = {
  NG: { name: "Nigeria", timezone: "Africa/Lagos", currency: "NGN", samplePhone: "+234 803 123 4567" },
  GH: { name: "Ghana", timezone: "Africa/Accra", currency: "GHS", samplePhone: "+233 24 123 4567" },
  KE: { name: "Kenya", timezone: "Africa/Nairobi", currency: "KES", samplePhone: "+254 712 345678" },
  ZA: { name: "South Africa", timezone: "Africa/Johannesburg", currency: "ZAR", samplePhone: "+27 71 234 5678" },
  GB: { name: "United Kingdom", timezone: "Europe/London", currency: "GBP", samplePhone: "+44 7911 123456" },
  US: { name: "United States", timezone: "America/New_York", currency: "USD", samplePhone: "+1 212 555 0123" },
};

/** Starter services (design p12) with editable prices in whole currency units. */
export const STARTER_SERVICES: { name: string; durationMin: number; loyaltyReward?: boolean }[] = [
  { name: "Haircut", durationMin: 30, loyaltyReward: true },
  { name: "Haircut + Beard", durationMin: 45 },
  { name: "Beard trim", durationMin: 20 },
  { name: "Kids cut", durationMin: 30 },
];

const STARTER_PRICES: Record<string, number[]> = {
  NGN: [3000, 4500, 2000, 2500],
  GHS: [60, 90, 40, 50],
  KES: [500, 800, 300, 400],
  ZAR: [150, 220, 100, 120],
  GBP: [20, 28, 12, 15],
  USD: [25, 35, 15, 18],
};

export function starterPrice(currency: string, index: number): number {
  return STARTER_PRICES[currency]?.[index] ?? 0;
}
