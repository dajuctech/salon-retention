import type { Page } from "@playwright/test";

/** People take a moment to fill in a form; the booking page rejects instant submissions (bot protection). */
export async function humanPause(page: Page) {
  await page.waitForTimeout(2100);
}

import { createHmac } from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), what authenticator apps compute from the setup key. */
export function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** Each browser project gets its own test data (phones, names), so they never collide. */
export function deviceNo(info: { project: { name: string } }): string {
  return { mobile: "1", desktop: "2", "mobile-safari": "3" }[info.project.name] ?? "9";
}
