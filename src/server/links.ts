// Signed customer links (US-11) and one-time invitation tokens (US-03).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function bookingSecret(): string {
  const secret = process.env.BOOKING_LINK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("BOOKING_LINK_SECRET is not set");
  return "dev-only-booking-link-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", bookingSecret()).update(payload).digest("base64url").slice(0, 32);
}

/** Token for the customer's confirmation / manage page; valid until `expiresAt`. */
export function signBookingToken(bookingId: string, expiresAt: Date): string {
  const payload = `${bookingId}.${Math.floor(expiresAt.getTime() / 1000).toString(36)}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyBookingToken(token: string, now = new Date()): { bookingId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [bookingId, exp, sig] = parts;
  const expected = Buffer.from(sign(`${bookingId}.${exp}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expiresAt = parseInt(exp, 36) * 1000;
  if (!Number.isFinite(expiresAt) || now.getTime() > expiresAt) return null;
  return { bookingId };
}

/** Customers can use their link until a day after the appointment ends. */
export function bookingLinkExpiry(endsAt: Date): Date {
  return new Date(endsAt.getTime() + 24 * 3600_000);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A random invitation token; only its hash is stored. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

// ───────── Bot protection for public forms (US-10 AC4) ─────────

export const MIN_FORM_SECONDS = 2;
const MAX_FORM_AGE_MS = 2 * 3600_000;

/** A signed "form shown at" timestamp. Bots can't forge it, and can't submit instantly. */
export function signFormToken(now = new Date()): string {
  const payload = `form.${now.getTime().toString(36)}`;
  return `${payload}.${sign(payload)}`;
}

export function checkFormToken(token: string, now = new Date()): "ok" | "invalid" | "too_fast" | "expired" {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "form") return "invalid";
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const given = Buffer.from(parts[2]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  const age = now.getTime() - parseInt(parts[1], 36);
  if (!Number.isFinite(age) || age < 0 || age > MAX_FORM_AGE_MS) return "expired";
  return age < MIN_FORM_SECONDS * 1000 ? "too_fast" : "ok";
}
