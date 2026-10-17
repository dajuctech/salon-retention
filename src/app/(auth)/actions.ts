"use server";

// Staff authentication (US-01, US-03, design p3). Error messages never reveal whether an
// email address has an account.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COUNTRIES } from "@/domain/countries";
import { getAuth } from "@/server/auth/auth";
import { acceptInvitation, createSalonForOwner, findInvitation } from "@/server/auth/onboarding";
import { ACTIVE_SALON_COOKIE, currentUser, membershipsFor } from "@/server/auth/session";
import { log } from "@/server/log";

export type FormState = { error?: string; info?: string; step?: "code" | "totp" } | null;

/** With two-step sign-in on, the first step returns this instead of a session. */
function needsSecondStep(res: unknown): boolean {
  return Boolean((res as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect);
}

const email = z.email("Enter a valid email address").transform((e) => e.trim().toLowerCase());
const password = z.string().min(10, "Use at least 10 characters").max(128);

async function rememberActiveSalon(userId: string, preferred?: string) {
  const memberships = await membershipsFor(userId);
  const chosen = memberships.find((m) => m.salonId === preferred) ?? memberships[0];
  if (chosen) {
    (await cookies()).set(ACTIVE_SALON_COOKIE, chosen.salonId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  return chosen;
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  let userId: string;
  try {
    const res = await getAuth().api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password, rememberMe: form.get("remember") === "on" },
      headers: await headers(),
    });
    if (needsSecondStep(res)) return { step: "totp" };
    userId = res.user.id;
  } catch (err) {
    return { error: authFailure(err) ? "Wrong email or password." : unexpected(err) };
  }
  const chosen = await rememberActiveSalon(userId);
  redirectAfterSignIn(form, chosen ? "/app" : "/signup");
}

export async function sendCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  try {
    await getAuth().api.sendVerificationOTP({ body: { email: parsed.data, type: "sign-in" }, headers: await headers() });
  } catch {
    // Same response either way, so the form can't be used to find out who has an account.
  }
  return { step: "code", info: `If ${parsed.data} has a staff account, we've sent a 6-digit code. It expires in 5 minutes.` };
}

export async function verifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email, otp: z.string().regex(/^\d{6}$/) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { step: "code", error: "Enter the 6-digit code." };
  let userId: string;
  try {
    const res = await getAuth().api.signInEmailOTP({ body: parsed.data, headers: await headers() });
    if (needsSecondStep(res)) return { step: "totp" };
    userId = res.user.id;
  } catch (err) {
    return { step: "code", error: authFailure(err) ? "That code is wrong or has expired." : unexpected(err) };
  }
  const chosen = await rememberActiveSalon(userId);
  redirectAfterSignIn(form, chosen ? "/app" : "/signup");
}

export async function signOutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } finally {
    (await cookies()).delete(ACTIVE_SALON_COOKIE);
  }
  redirect("/login");
}

export async function requestResetAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  try {
    await getAuth().api.requestPasswordReset({ body: { email: parsed.data }, headers: await headers() });
  } catch {
    // Don't reveal whether the account exists.
  }
  return { info: `If ${parsed.data} has an account, we've emailed a reset link. It works for 1 hour.` };
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ token: z.string().min(10), password }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  try {
    await getAuth().api.resetPassword({ body: { token: parsed.data.token, newPassword: parsed.data.password }, headers: await headers() });
  } catch {
    return { error: "This reset link has expired. Ask for a new one." };
  }
  redirect("/login?reset=1");
}

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email,
  password,
  salonName: z.string().trim().min(2, "Enter your salon's name").max(80),
  country: z.string().refine((c) => c in COUNTRIES, "Choose a country"),
});

/** US-01: owner account + salon. A signed-in user without a salon only fills in the salon part. */
export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const existing = await currentUser();
  const data = Object.fromEntries(form);
  const alsoBarber = form.get("alsoBarber") === "on";

  if (existing) {
    const parsed = signUpSchema.pick({ salonName: true, country: true }).safeParse(data);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const { salonId } = await createSalonForOwner(existing, { ...parsed.data, alsoBarber });
    await rememberActiveSalon(existing.id, salonId);
    redirect("/app?welcome=1");
  }

  const parsed = signUpSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  let user: { id: string; name: string };
  try {
    const res = await getAuth().api.signUpEmail({
      body: { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
    user = res.user;
  } catch (err) {
    const msg = String((err as { message?: string })?.message ?? "");
    if (/exist/i.test(msg)) return { error: "An account with this email already exists. Sign in instead." };
    if (/compromised|pwned|breach/i.test(msg)) return { error: "That password has appeared in a data breach. Please choose another." };
    return { error: "We couldn't create your account. Please try again." };
  }
  const { salonId } = await createSalonForOwner(user, { salonName: parsed.data.salonName, country: parsed.data.country, alsoBarber });
  await rememberActiveSalon(user.id, salonId);
  redirect("/app?welcome=1");
}

/** US-03: accept a staff invitation, creating the account first if needed. */
export async function acceptInviteAction(token: string, _prev: FormState, form: FormData): Promise<FormState> {
  const inv = await findInvitation(token);
  if (!inv) return { error: "This invitation has expired or was already used." };
  let user = await currentUser();
  if (!user) {
    const parsed = z.object({ name: z.string().trim().min(2, "Enter your name"), password }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    try {
      const res = await getAuth().api.signUpEmail({
        body: { name: parsed.data.name, email: inv.email, password: parsed.data.password },
        headers: await headers(),
      });
      user = res.user;
    } catch {
      return { error: "An account already exists for this email. Sign in first, then open the invitation link again." };
    }
  }
  const result = await acceptInvitation(token, user);
  if (!result.ok) return { error: result.message };
  await rememberActiveSalon(user.id, result.salonId);
  redirect("/app");
}

/** Switch between salons for staff who belong to more than one. */
export async function switchSalonAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  await rememberActiveSalon(user.id, String(form.get("salonId")));
  redirect("/app");
}

function redirectAfterSignIn(form: FormData, fallback: string): never {
  const next = String(form.get("next") ?? "");
  // Only same-site paths, never an open redirect.
  redirect(next.startsWith("/app") || next.startsWith("/invite/") ? next : fallback);
}

/** Better Auth rejects bad credentials with 4xx; anything else is our problem, not the user's. */
function authFailure(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  return typeof code === "number" && code >= 400 && code < 500;
}

function unexpected(err: unknown): string {
  log.error("auth.unexpected", err);
  return "Sign-in isn't working right now. Please try again in a moment.";
}

/** Second step: a code from the authenticator app, or a one-time backup code. */
export async function verifyTwoFactorAction(_prev: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const backup = form.get("backup") === "on";
  if (!code) return { step: "totp", error: "Enter the code." };
  let userId: string;
  try {
    const res = backup
      ? await getAuth().api.verifyBackupCode({ body: { code }, headers: await headers() })
      : await getAuth().api.verifyTOTP({ body: { code, trustDevice: form.get("trust") === "on" }, headers: await headers() });
    userId = (res as { user: { id: string } }).user.id;
  } catch (err) {
    return { step: "totp", error: authFailure(err) ? "That code didn't work. Check the time on your phone and try again." : unexpected(err) };
  }
  const chosen = await rememberActiveSalon(userId);
  redirectAfterSignIn(form, chosen ? "/app" : "/signup");
}

export type TwoFactorSetup = { error?: string; qr?: string; secret?: string; backupCodes?: string[]; enabled?: boolean; info?: string } | null;

/** Account page: start turning on two-step sign-in (needs the password again). */
export async function startTwoFactorAction(_prev: TwoFactorSetup, form: FormData): Promise<TwoFactorSetup> {
  const password = String(form.get("password") ?? "");
  try {
    const res = (await getAuth().api.enableTwoFactor({ body: { password }, headers: await headers() })) as { totpURI: string; backupCodes: string[] };
    const { toDataURL } = await import("qrcode");
    const secret = new URL(res.totpURI).searchParams.get("secret") ?? "";
    return { qr: await toDataURL(res.totpURI, { margin: 1, width: 220 }), secret, backupCodes: res.backupCodes };
  } catch (err) {
    return { error: authFailure(err) ? "Wrong password." : unexpected(err) };
  }
}

/** Account page: confirm with the first code from the app; only then is it switched on. */
export async function confirmTwoFactorAction(_prev: TwoFactorSetup, form: FormData): Promise<TwoFactorSetup> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  try {
    await getAuth().api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch (err) {
    return { error: authFailure(err) ? "That code didn't work. Try the newest code in the app." : unexpected(err) };
  }
  return { enabled: true, info: "Two-step sign-in is on." };
}

export async function disableTwoFactorAction(_prev: TwoFactorSetup, form: FormData): Promise<TwoFactorSetup> {
  try {
    await getAuth().api.disableTwoFactor({ body: { password: String(form.get("password") ?? "") }, headers: await headers() });
  } catch (err) {
    return { error: authFailure(err) ? "Wrong password." : unexpected(err) };
  }
  return { enabled: false, info: "Two-step sign-in is off." };
}
