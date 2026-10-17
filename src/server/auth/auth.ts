// Identity only (ADR-0003, amended): Better Auth handles users, passwords, sessions and sign-in
// codes. Salon membership and roles live in our own Member table and permission matrix.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { twoFactor } from "better-auth/plugins/two-factor";
import { unscopedDb } from "@/server/db";
import { sendEmail } from "@/server/email";

function createAuth() {
  const baseURL = process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const extraOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const breachedCheck = process.env.NODE_ENV === "production" && process.env.HIBP_CHECK !== "off";

  return betterAuth({
    baseURL,
    trustedOrigins: [baseURL, ...extraOrigins],
    database: prismaAdapter(unscopedDb(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        const base = (process.env.APP_URL ?? baseURL).replace(/\/$/, "");
        await sendEmail({
          to: user.email,
          subject: "Reset your password",
          text: `Reset your password here (valid for 1 hour): ${base}/reset-password?token=${encodeURIComponent(token)}\nIf you didn't ask for this, ignore this email.`,
        });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 30 },
    plugins: [
      emailOTP({
        // Codes are for existing staff only; accounts are created by sign-up or invitation.
        disableSignUp: true,
        otpLength: 6,
        expiresIn: 300,
        async sendVerificationOTP({ email, otp }) {
          await sendEmail({
            to: email,
            subject: "Your sign-in code",
            text: `Your sign-in code is ${otp}. It expires in 5 minutes. If you didn't ask for it, ignore this email.`,
          });
        },
      }),
      // Optional two-step sign-in with an authenticator app (recommended for owners).
      twoFactor({ issuer: "Salon Booking" }),
      ...(breachedCheck ? [haveIBeenPwned()] : []),
      nextCookies(), // must be last: lets server actions set the session cookie
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Created lazily so importing this module never needs DATABASE_URL (e.g. during build). */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}
