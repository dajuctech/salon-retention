// Offer wording is generated from a Promotion record, never written by AI or free text (BR-PR2).
import { formatMoney } from "./money";

export type PromotionLike = {
  kind: "PERCENT" | "FIXED" | "FREE_SERVICE";
  value: number;
  serviceNames: string[];
  endsOn: Date; // salon-local date stored as UTC midnight
};

function servicesPhrase(names: string[]): string {
  if (names.length === 0) return "any service";
  if (names.length === 1) return `any ${names[0].toLowerCase()}`;
  return `${names.slice(0, -1).join(", ").toLowerCase()} or ${names.at(-1)!.toLowerCase()}`;
}

export function offerLine(p: PromotionLike, currency: string): string {
  const until = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(p.endsOn);
  const what = servicesPhrase(p.serviceNames);
  if (p.kind === "PERCENT") return `Enjoy ${p.value}% off ${what} until ${until}.`;
  if (p.kind === "FIXED") return `Enjoy ${formatMoney(p.value, currency)} off ${what} until ${until}.`;
  return `Enjoy a free ${p.serviceNames[0]?.toLowerCase() ?? "service"} on your next visit until ${until}.`;
}

export const NO_OFFER_BIRTHDAY_LINE = "We'd love to see you soon.";

export function isPromotionActive(p: { active: boolean; startsOn: Date; endsOn: Date }, todayKey: string): boolean {
  const start = p.startsOn.toISOString().slice(0, 10);
  const end = p.endsOn.toISOString().slice(0, 10);
  return p.active && start <= todayKey && todayKey <= end;
}
