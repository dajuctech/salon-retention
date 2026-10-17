// Loyalty punch card (BR-L1 – BR-L4). Stamps are always derived, never stored.

export type LoyaltyStatus = {
  stamps: number;
  threshold: number;
  rewardAvailable: boolean;
};

/**
 * @param paidCompletedVisits completed bookings with price > 0 (BR-L1)
 * @param redemptions loyalty rewards already used
 */
export function loyaltyStatus(
  paidCompletedVisits: number,
  redemptions: number,
  threshold: number,
): LoyaltyStatus {
  if (threshold < 1) throw new Error("threshold must be >= 1");
  // Stamps past the threshold carry over after a redemption (BR-L3).
  const stamps = Math.max(paidCompletedVisits - redemptions * threshold, 0);
  return { stamps, threshold, rewardAvailable: stamps >= threshold };
}
