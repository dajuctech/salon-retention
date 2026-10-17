// Role → capability matrix (docs/permissions.md). Enforced server-side by src/server/authz.ts.

export const ROLES = ["owner", "receptionist", "barber"] as const;
export type Role = (typeof ROLES)[number];

/**
 * "own" means the barber may act only on their own bookings or availability;
 * the caller must check ownership as well.
 */
type Grant = true | "own";

const MATRIX = {
  "salon.settings": { owner: true },
  "staff.manage": { owner: true },
  "services.manage": { owner: true },
  "availability.edit": { owner: true, receptionist: true, barber: "own" },
  "customers.view": { owner: true, receptionist: true, barber: "own" },
  "customers.viewPhone": { owner: true, receptionist: true },
  "customers.edit": { owner: true, receptionist: true },
  "customers.merge": { owner: true, receptionist: true },
  "customers.exportDelete": { owner: true },
  "bookings.manage": { owner: true, receptionist: true, barber: "own" },
  "bookings.complete": { owner: true, receptionist: true, barber: "own" },
  "bookings.correct": { owner: true },
  "payments.record": { owner: true, receptionist: true, barber: "own" },
  "payments.refund": { owner: true },
  "reports.view": { owner: true },
  "reports.viewToday": { owner: true, receptionist: true },
  "messages.viewLog": { owner: true, receptionist: true },
  "consent.edit": { owner: true, receptionist: true },
  "promotions.approve": { owner: true },
  "winback.approve": { owner: true },
  "inbox.use": { owner: true, receptionist: true },
  "messaging.settings": { owner: true },
  "loyalty.redeem": { owner: true, receptionist: true, barber: "own" },
  "loyalty.settings": { owner: true },
  "ai.copyAssistant": { owner: true },
  "audit.view": { owner: true },
} as const satisfies Record<string, Partial<Record<Role, Grant>>>;

export type Capability = keyof typeof MATRIX;

export function grantFor(role: Role, capability: Capability): Grant | false {
  const grants: Partial<Record<Role, Grant>> = MATRIX[capability];
  return grants[role] ?? false;
}

/** True if the role may perform the capability (for "own" grants, `isOwnResource` must be true). */
export function can(role: Role, capability: Capability, isOwnResource = false): boolean {
  const grant = grantFor(role, capability);
  return grant === true || (grant === "own" && isOwnResource);
}
