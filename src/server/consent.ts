// Consent (BR-R1, BR-R2): append-only history plus the current flags on Customer, always
// updated together so message checks never read a stale state.
import type { ConsentPurpose, ConsentSource } from "@/generated/prisma/client";
import type { DbLike } from "./audit";

export {
  MARKETING_CONSENT_WORDING,
  STAFF_MARKETING_WORDING,
  STAFF_UTILITY_WORDING,
  UTILITY_CONSENT_WORDING,
} from "@/domain/consent-wording";

export type ConsentChange = {
  salonId: string;
  customerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  wording: string;
  actorId?: string | null;
};

/** Records a consent change. A repeat of the current state (same wording) is not recorded again. */
export async function setConsent(db: DbLike, c: ConsentChange): Promise<boolean> {
  const latest = await db.consent.findFirst({
    where: { customerId: c.customerId, purpose: c.purpose },
    orderBy: { createdAt: "desc" },
  });
  if (latest && latest.granted === c.granted && (latest.wording === c.wording || !c.granted)) return false;

  await db.consent.create({
    data: {
      salonId: c.salonId,
      customerId: c.customerId,
      purpose: c.purpose,
      granted: c.granted,
      source: c.source,
      wording: c.wording,
      actorId: c.actorId ?? null,
    },
  });
  await db.customer.update({
    where: { id: c.customerId },
    data: c.purpose === "UTILITY" ? { utilityConsent: c.granted } : { marketingConsent: c.granted },
  });
  return true;
}
