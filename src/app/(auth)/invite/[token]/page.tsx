// US-03: accept a staff invitation.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { findInvitation } from "@/server/auth/onboarding";
import { currentUser } from "@/server/auth/session";
import { AuthShell } from "../../auth-shell";
import { AcceptInviteForm } from "./accept-form";

export const instant = false;

const ROLE_LABEL = { owner: "an owner", receptionist: "a receptionist", barber: "a barber" } as const;

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <AuthShell eyebrow="Staff invitation" title="Join your salon" subtitle="Accept to see bookings and customers.">
      <Suspense>
        <Invite params={params} />
      </Suspense>
    </AuthShell>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const inv = await findInvitation(token);
  if (!inv) {
    return (
      <p className="rounded-xl bg-status-danger px-4 py-3 text-status-danger-ink">
        This invitation has expired or was already used. Ask the salon owner to send a new one.
      </p>
    );
  }
  const user = await currentUser();
  const wrongAccount = user && user.email.toLowerCase() !== inv.email.toLowerCase();
  return (
    <div className="space-y-4">
      <p className="text-lg">
        {inv.inviter.name} invited <strong>{inv.email}</strong> to join <strong>{inv.salon.name}</strong> as{" "}
        {ROLE_LABEL[inv.role]}.
      </p>
      {wrongAccount ? (
        <p className="rounded-xl bg-status-danger px-4 py-3 text-sm text-status-danger-ink">
          You&apos;re signed in as {user.email}. Sign out and sign in as {inv.email} to accept.
        </p>
      ) : (
        <AcceptInviteForm token={token} needsAccount={!user} />
      )}
      {!user && (
        <p className="text-center text-sm">
          Already have an account?{" "}
          <Link href={`/login?next=/invite/${token}`} className="font-semibold text-brand-900 underline">
            Sign in first
          </Link>
        </p>
      )}
    </div>
  );
}
