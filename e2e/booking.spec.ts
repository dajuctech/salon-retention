import { expect, test } from "@playwright/test";
import { humanPause } from "./helpers";

// US-10: a customer books without an account, then sees the confirmation (design p1–p2).
test("customer books a haircut with any barber", async ({ page }) => {
  await page.goto("/sharpandco");
  await expect(page.getByRole("heading", { name: "Book your cut" })).toBeVisible();
  await page.screenshot({ path: "e2e/.results/01-booking.png", fullPage: true });

  // Taken slots are visible but unavailable. Tunde has seeded bookings on his next working day,
  // so this doesn't depend on the time of day the test runs.
  await page.getByRole("radiogroup", { name: "Barber" }).getByRole("radio", { name: /^Tunde/ }).click();
  const nextWorkday = await page.evaluate(() => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000);
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "Africa/Lagos" }).format(d);
    const d = fmt(day(1), { weekday: "short" }) === "Sun" ? day(2) : day(1);
    return `${fmt(d, { weekday: "short" })} ${Number(fmt(d, { day: "numeric" }))}`;
  });
  await page.getByRole("radiogroup", { name: "Date" }).getByRole("radio", { name: new RegExp(`^${nextWorkday}`) }).click();
  await expect(page.getByRole("radio", { name: /unavailable/ }).first()).toBeDisabled();

  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Name").fill("Tolu Bakare");
  await page.getByLabel("WhatsApp number").fill("0803 123 4567");
  await page.screenshot({ path: "e2e/.results/02-filled.png", fullPage: true });

  await humanPause(page);

  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "You're booked, Tolu" })).toBeVisible();
  await expect(page.getByText(/SC-\d{4}/)).toBeVisible();
  await page.screenshot({ path: "e2e/.results/03-confirmed.png", fullPage: true });
});

test("rejects an invalid WhatsApp number", async ({ page }) => {
  await page.goto("/sharpandco");
  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Name").fill("Test User");
  await page.getByLabel("WhatsApp number").fill("123456");
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("valid WhatsApp number")).toBeVisible();
});

test("confirm explains what is missing instead of doing nothing", async ({ page }) => {
  await page.goto("/sharpandco");
  await page.getByLabel("Name").fill("Tolu Bello");
  await page.getByLabel("WhatsApp number").fill("+447400123456"); // libphonenumber's published example UK mobile, not a real person's
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pick a time first." })).toBeVisible();

  // Picking a time clears the hint, and an international number books fine.
  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Pick a time first." })).toHaveCount(0);
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "You're booked, Tolu" })).toBeVisible();
});
