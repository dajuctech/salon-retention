// Resolves the signed-in user to their membership in one salon (docs/permissions.md).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ActingMember } from "@/server/authz";
import { unscopedDb } from "@/server/db";
import { getAuth } from "./auth";

export const ACTIVE_SALON_COOKIE = "active_salon";

export const currentUser = cache(async () => {
  // Read cookies through cookies(), not the raw request header: after a server action rotates the
  // session (e.g. turning on two-step sign-in) the same response re-renders the page, and only
  // cookies() sees the new session cookie. The raw header still holds the deleted one.
  const h = new Headers(await headers());
  h.set("cookie", (await cookies()).toString());
  const session = await getAuth().api.getSession({ headers: h });
  return session?.user ?? null;
});

/** Active memberships for a user, newest first. */
export async function membershipsFor(userId: string) {
  return unscopedDb().member.findMany({
    where: { userId, active: true },
    include: { salon: true, barber: true },
    orderBy: { createdAt: "desc" },
  });
}

export type StaffContext = {
  member: ActingMember;
  user: { id: string; name: string; email: string };
  salon: NonNullable<Awaited<ReturnType<typeof membershipsFor>>[number]>["salon"];
};

/**
 * The signed-in staff member for this request, or a redirect: to /login when signed out,
 * to /signup when the account has no salon yet (e.g. sign-up was interrupted).
 */
export const requireStaff = cache(async (): Promise<StaffContext> => {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await membershipsFor(user.id);
  if (memberships.length === 0) redirect("/signup");

  const m = pickMembership(memberships, (await cookies()).get(ACTIVE_SALON_COOKIE)?.value);
  return {
    member: actingMember(user.id, m),
    user: { id: user.id, name: user.name, email: user.email },
    salon: m.salon,
  };
});

type Membership = Awaited<ReturnType<typeof membershipsFor>>[number];

/** The salon chosen with the active-salon cookie, else the newest membership. */
export function pickMembership<M extends Membership>(memberships: M[], preferredSalonId: string | undefined): M {
  return memberships.find((x) => x.salonId === preferredSalonId) ?? memberships[0];
}

export function actingMember(userId: string, m: Membership): ActingMember {
  return { userId, salonId: m.salonId, role: m.role, barberId: m.barber?.id ?? null };
}
