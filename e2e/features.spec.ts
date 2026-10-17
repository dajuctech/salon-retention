// Features added in the second build round. Requires a freshly seeded demo salon (pnpm db:seed),
// PAYMENTS_MODE=fake, and for production builds ALLOW_DEV_TOOLS=true (simulated checkout).
import { expect, test, type Page } from "@playwright/test";
import { humanPause, totp, deviceNo } from "./helpers";

const PASSWORD = "demo-password-123";

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("forbidden and missing pages return a real 404 status", async ({ page }) => {
  expect((await page.goto("/no-such-salon"))?.status()).toBe(404);
  expect((await page.goto("/sharpandco/booking/forged.token.value"))?.status()).toBe(404);
  await signIn(page, "tunde@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  for (const path of ["/app/reports", "/app/whatsapp", "/app/customers/does-not-exist"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("US-10 AC4 bot protection: instant or honeypot submissions are refused", async ({ page }) => {
  await page.goto("/sharpandco", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Name").fill("Fast Bot");
  await page.getByLabel("WhatsApp number").fill("0803 777 0301");
  await page.getByRole("button", { name: "Confirm booking" }).click(); // no pause: too fast
  await expect(page.getByRole("alert").filter({ hasText: "Please check your details" })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Name").fill("Honeypot Bot");
  await page.getByLabel("WhatsApp number").fill("0803 777 0302");
  await page.locator('input[name="website"]').evaluate((el: HTMLInputElement) => (el.value = "http://spam.example"));
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
});

test("US-17 customer pays online from their booking page (simulated checkout)", async ({ page }, info) => {
  await page.goto("/sharpandco", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Name").fill("Online Payer");
  await page.getByLabel("WhatsApp number").fill(`0803 777 040${deviceNo(info)}`);
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /You're booked/ })).toBeVisible();
  await page.getByRole("button", { name: /^Pay ₦3,000 now$/ }).click();
  await expect(page.getByText("Test checkout: no real money moves")).toBeVisible();
  await page.getByRole("button", { name: "Pay (test)" }).click();
  await expect(page.getByRole("heading", { name: /You're booked/ })).toBeVisible();
  await expect(page.getByText("Paid ✓")).toBeVisible();
  await expect(page.getByRole("button", { name: /now$/ })).toHaveCount(0);
});

test("Offer campaign: owner previews, then sends to a group", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "one campaign per seed");
  await signIn(page, "owner@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/whatsapp/offers");
  await expect(page.getByRole("button", { name: "Preview first" })).toBeDisabled();
  await page.getByLabel("Message").fill("Get 50% off today!");
  await page.getByRole("button", { name: "Preview who gets it" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "use {{offer}}" })).toBeVisible();
  await page.getByLabel("Message").fill("Hi {{first_name}}, {{salon_name}} has something for you: {{offer}}");
  await page.getByRole("button", { name: "Preview who gets it" }).click();
  await expect(page.getByText(/customers will get this/)).toBeVisible();
  await expect(page.getByText(/Enjoy 10% off any haircut/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Approve and send to \d+/ }).click();
  await expect(page).toHaveURL(/\/app\/whatsapp\?tab=sent/);
  await expect(page.getByRole("status")).toContainText(/offer messages? approved/);
});

test("US-14 AC2 drag a booking to a new time on the calendar", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "mouse drag; phones use the same handle with touch");
  await signIn(page, "owner@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  // The seed's "tomorrow" bookings are on Tunde's next working day (he doesn't work Sundays).
  const nextDay = await page.evaluate(() => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000);
    const sunday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Africa/Lagos" }).format(day(1)) === "Sun";
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(day(sunday ? 2 : 1));
  });
  await page.goto(`/app/calendar?date=${nextDay}&barber=all`, { waitUntil: "networkidle" });
  const handle = page.getByRole("button", { name: /Drag to move Sola Peters/ });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // 100 px per hour: five hours down → 14:00, which is free for Tunde.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 250, { steps: 10 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 500, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("Moved to 14:00");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: /Sola Peters.*14:00/ })).toBeVisible();
});

test("Opening hours can have a break (several ranges per day)", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "settings change once per seed");
  await signIn(page, "owner@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/settings", { waitUntil: "networkidle" });
  const hoursForm = page.locator("form", { has: page.getByRole("button", { name: "Save opening hours" }) });
  await hoursForm.getByLabel("Mon range 1 to").fill("13:00");
  await hoursForm.getByRole("button", { name: "+ Add hours (e.g. after a break)" }).first().click();
  await hoursForm.getByLabel("Mon range 2 from").fill("14:00");
  await hoursForm.getByLabel("Mon range 2 to").fill("19:00");
  await hoursForm.getByRole("button", { name: "Save opening hours" }).click();
  await expect(hoursForm.getByRole("status")).toContainText("Opening hours saved");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("form", { has: page.getByRole("button", { name: "Save opening hours" }) }).getByLabel("Mon range 2 from")).toHaveValue("14:00");
});

test("Two-step sign-in: turn it on, then sign in with an authenticator code", async ({ page }, info) => {
  const email = `twofa-${info.project.name}-${Date.now()}@example.test`;
  const password = "a-strong-password-2";
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("Secure Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Salon name").fill("Secure Cuts");
  await page.getByRole("button", { name: "Create salon" }).click();
  await expect(page).toHaveURL(/\/app\?welcome=1/);

  await page.goto("/app/more", { waitUntil: "networkidle" });
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Turn on" }).click();
  const secret = (await page.locator("code").textContent())!.trim();
  await expect(page.getByRole("list", { name: "Backup codes" }).getByRole("listitem")).toHaveCount(10);
  await page.getByLabel("3. Enter the 6-digit code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.getByText("Two-step sign-in is on.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, email, password);
  await expect(page.getByLabel("Code from your app")).toBeVisible(); // password alone isn't enough
  await page.getByLabel("Code from your app").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();
  await page.getByLabel("Code from your app").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("ADR-0006 owner connects their own payout account before customers can pay online", async ({ page }, info) => {
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("Payout Owner");
  await page.getByLabel("Email").fill(`payout-${info.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("a-strong-password-3");
  await page.getByLabel("Salon name").fill("Payout Cuts");
  await page.getByRole("button", { name: "Create salon" }).click();
  await expect(page).toHaveURL(/\/app\?welcome=1/);

  await page.goto("/app/settings", { waitUntil: "networkidle" });
  await page.getByLabel("Online payments").selectOption("PAYSTACK");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const account = page.getByRole("group", { name: "Payout account" });
  await expect(account).toContainText("Customers can't pay online until you connect");
  await account.getByLabel("Bank").selectOption({ label: "Test Bank A" });
  await account.getByLabel("Account number").fill("0123456789");
  await account.getByRole("button", { name: "Connect account" }).click();
  await expect(account).toContainText("Payouts go to: Test Bank A ••••6789");

  // Switching provider disconnects the old account; Stripe setup happens on Stripe (simulated here).
  await page.getByLabel("Online payments").selectOption("STRIPE");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(account.getByRole("button", { name: "Set up Stripe" })).toBeVisible();
  await account.getByRole("button", { name: "Set up Stripe" }).click();
  await expect(page).toHaveURL(/\/app\/settings\?payments=connected/);
  await expect(page.getByRole("group", { name: "Payout account" })).toContainText("Payouts go to: Stripe test account");
});

test("Large screens get a side navigation that respects roles", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "desktop layout");
  await signIn(page, "tunde@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  const nav = page.getByRole("navigation", { name: "Main" }).filter({ hasText: "Account" });
  await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "My hours" })).toBeVisible();
});

test("US-14 / US-15 week and month calendar views, with payment status on each booking", async ({ page }) => {
  await signIn(page, "reception@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/calendar", { waitUntil: "networkidle" });
  // Day view: status and payment status on each booking (US-14 AC3).
  await expect(page.getByRole("link", { name: /Gbenga Ali.*Done · Paid/ })).toBeVisible();

  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/view=week/);
  const week = page.getByRole("list", { name: "Week" });
  await expect(week.getByRole("listitem").filter({ has: page.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+/) })).toHaveCount(7);
  await expect(week.getByRole("link", { name: /Uche Nwosu/ })).toContainText("Balance"); // part-paid in the seed
  await page.getByRole("link", { name: "Next week →" }).click();
  await expect(page).toHaveURL(/view=week.*date=/);

  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month" }).click();
  const month = page.getByRole("table");
  await expect(month).toBeVisible();
  const busyDay = month.getByRole("link", { name: /: [1-9]\d* bookings?$/ }).first();
  await busyDay.click();
  await expect(page).toHaveURL(/view=day/);
});

test("Owner pauses all sending; staff screens say so until it resumes", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "changes salon-wide state once per seed");
  await signIn(page, "owner@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/whatsapp", { waitUntil: "networkidle" });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Pause all sending" }).click();
  await expect(page.getByText("Sending is paused", { exact: true })).toBeVisible();
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByRole("status").filter({ hasText: "WhatsApp sending is paused" })).toBeVisible();
  await page.goto("/app/whatsapp", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Resume sending" }).click();
  await expect(page.getByText("Sending is on", { exact: true })).toBeVisible();
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByText("WhatsApp sending is paused")).toHaveCount(0);
});

test("Staff see an offline banner when the connection drops", async ({ page, context }) => {
  await signIn(page, "reception@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You're offline")).toHaveCount(0);
});

test("Owners are told how AI suggestions work", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "static content");
  await signIn(page, "owner@sharpandco.test");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/whatsapp/templates", { waitUntil: "networkidle" });
  await page.getByText("How AI suggestions work").first().click();
  await expect(page.getByText("never your customers' names or numbers").first()).toBeVisible();
});
