// Stripe Connect onboarding comes back here (ADR-0006). `return`: check whether the salon's account
// can take charges yet. `refresh`: the one-time link expired, so make a new one.
import { notFound, redirect } from "next/navigation";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { refreshStripeAccount, startStripeConnect } from "@/server/staff/settings";

export async function GET(request: Request) {
  const s = await requireStaff();
  if (!can(s.member.role, "salon.settings")) notFound();
  const ctx = { member: s.member, salon: s.salon, user: s.user };
  if (new URL(request.url).searchParams.get("step") === "refresh") {
    const r = await startStripeConnect(ctx, s.user.email);
    redirect(r.ok ? r.value.url : "/app/settings?payments=error#payments");
  }
  const r = await refreshStripeAccount(ctx);
  redirect(`/app/settings?payments=${!r.ok ? "error" : r.value.ready ? "connected" : "pending"}#payments`);
}
