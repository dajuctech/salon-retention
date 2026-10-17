// Server-side authorization (docs/permissions.md). Hiding UI is never enough.
import { can, type Capability, type Role } from "@/domain/permissions";

export type ActingMember = {
  userId: string;
  salonId: string;
  role: Role;
  /** Set when the member is also a barber; used for "own" grants. */
  barberId: string | null;
};

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(readonly capability: Capability) {
    super(`Forbidden: ${capability}`);
  }
}

/**
 * @param resourceBarberId barber that owns the booking/availability being acted on, if any
 */
export function assertCan(member: ActingMember, capability: Capability, resourceBarberId?: string | null): void {
  const isOwn = member.barberId !== null && resourceBarberId != null && resourceBarberId === member.barberId;
  if (!can(member.role, capability, isOwn)) throw new ForbiddenError(capability);
}
