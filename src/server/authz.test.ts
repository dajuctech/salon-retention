import { describe, expect, it } from "vitest";
import { ForbiddenError, assertCan, type ActingMember } from "./authz";

const tunde: ActingMember = { userId: "u1", salonId: "s1", role: "barber", barberId: "b-tunde" };

describe("assertCan", () => {
  it("lets a barber complete their own booking but not a colleague's", () => {
    expect(() => assertCan(tunde, "bookings.complete", "b-tunde")).not.toThrow();
    expect(() => assertCan(tunde, "bookings.complete", "b-chidi")).toThrow(ForbiddenError);
    expect(() => assertCan(tunde, "bookings.complete")).toThrow(ForbiddenError);
  });

  it("never treats a missing barberId as ownership", () => {
    const receptionistWithoutBarber: ActingMember = { ...tunde, role: "barber", barberId: null };
    expect(() => assertCan(receptionistWithoutBarber, "bookings.complete", null)).toThrow(ForbiddenError);
  });

  it("allows owner-only capabilities for owners", () => {
    expect(() => assertCan({ ...tunde, role: "owner", barberId: null }, "winback.approve")).not.toThrow();
  });
});
