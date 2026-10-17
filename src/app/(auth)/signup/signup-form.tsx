"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { inputClass, labelClass, primaryButton } from "@/components/ui";
import { signUpAction } from "../actions";
import { FormMessage } from "../auth-shell";

type Props = { signedInAs: { name: string; email: string } | null; countries: { code: string; name: string }[] };

export function SignUpForm({ signedInAs, countries }: Props) {
  const [state, action] = useActionState(signUpAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage error={state?.error} />
      {signedInAs ? (
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Signed in as {signedInAs.email}. Add your salon to finish setting up.
        </p>
      ) : (
        <>
          <Field label="Your name" name="name" autoComplete="name" />
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <Field label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." minLength={10} />
        </>
      )}
      <Field label="Salon name" name="salonName" autoComplete="organization" />
      <div>
        <label className={labelClass} htmlFor="country">
          Country
        </label>
        <select id="country" name="country" defaultValue="NG" className={inputClass}>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-ink-muted">Sets your timezone, currency and phone format. You can change these later.</p>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" name="alsoBarber" className="size-5 accent-brand-900" />I also cut hair (add me as a barber)
      </label>
      <SubmitButton className={primaryButton} pendingText="Creating your salon…">
        Create salon
      </SubmitButton>
      {!signedInAs && (
        <p className="text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-900 underline">
            Sign in
          </Link>
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  hint,
  ...rest
}: { label: string; name: string; type?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={labelClass} htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} type={type} required className={inputClass} {...rest} />
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}
