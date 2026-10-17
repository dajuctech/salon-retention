// Staff flows end to end. Requires a freshly seeded demo salon (pnpm db:seed).
import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { humanPause, deviceNo } from "./helpers";

const PASSWORD = "demo-password-123";

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  return errors;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("staff pages require sign-in", async ({ page }) => {
  await page.goto("/app/customers");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password is refused without saying whether the account exists", async ({ page }) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill("owner@sharpandco.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Wrong email or password." })).toBeVisible();
});

test("US-09 receptionist records a walk-in, then takes payment", async ({ page }, info) => {
  const errors = watch(page);
  await signIn(page, "reception@sharpandco.test");
  await page.getByRole("link", { name: "Walk-in" }).click();
  const phone = `0803 777 000${deviceNo(info)}`;
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel(/^Name/).fill(`Walk In ${info.project.name}`);
  await page.locator("label", { hasText: "Beard trim" }).click();
  await page.getByRole("button", { name: "Save walk-in" }).click();
  await expect(page.getByRole("status")).toContainText(/is now in chair with/);

  await page.goto("/app/payments");
  await expect(page.getByText(`Walk In ${info.project.name}`, { exact: true })).toBeVisible();
  await page
    .locator("div.space-y-2", { hasText: `Walk In ${info.project.name}` })
    .getByRole("button", { name: "Mark as paid" })
    .click();
  await page.locator("div.space-y-2", { hasText: `Walk In ${info.project.name}` }).getByText("Transfer").click();
  await page.locator("div.space-y-2", { hasText: `Walk In ${info.project.name}` }).getByRole("button", { name: /^Paid/ }).click();
  await expect(page.getByRole("heading", { name: "Paid today" })).toBeVisible();
  // This device's own row (other browsers record their own walk-ins in the same salon).
  const paidRow = page.getByText(`Walk In ${info.project.name}`, { exact: true }).locator("..");
  await expect(paidRow).toContainText("Beard trim · Transfer");
  expect(errors).toEqual([]);
});

test("US-22 owner approves all win-back drafts and they send", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "drafts are consumed once per seed");
  const errors = watch(page);
  await signIn(page, "owner@sharpandco.test");
  await page.goto("/app/whatsapp/approve");
  await expect(page.getByText(/Why now: Last visit/).first()).toBeVisible();
  // "Sharp & Co." must not become "Co.." in the message.
  await expect(page.getByText(/Sharp & Co\.\./)).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Approve all \d/ }).click();
  await expect(page).toHaveURL(/\/app\/whatsapp\?tab=sent/);
  await expect(page.getByRole("status")).toContainText(/3 approved/);
  await expect(page.getByText("Win-back").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("US-19 a customer replying STOP through the real WhatsApp webhook is opted out", async ({ page, request }) => {
  test.skip(test.info().project.name !== "mobile", "one opt-out per seed");
  // Exactly what Meta sends: a signed webhook. An unsigned one must be rejected.
  const secret = process.env.META_APP_SECRET ?? "dev-meta-app-secret";
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: "2348035550151", id: `wamid.e2e.${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "STOP" } }] } }] }],
  });
  const unsigned = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json" } });
  expect(unsigned.status()).toBe(401);
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const signed = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": signature } });
  expect(signed.status()).toBe(200);

  await signIn(page, "owner@sharpandco.test");
  await page.goto("/app/customers?q=Chinedu");
  await page.getByRole("link", { name: /Chinedu Eze/ }).click();
  await expect(page.getByText("Reminders on · Offers off")).toBeVisible();
  await page.goto("/app/whatsapp?tab=inbox");
  await expect(page.getByText("Chinedu Eze")).toBeVisible();
});

test("barbers don't see WhatsApp, revenue or customer phone numbers", async ({ page }) => {
  await signIn(page, "tunde@sharpandco.test");
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  await expect(page.getByText("Revenue today")).toHaveCount(0);
  await page.goto("/app/customers");
  await page.getByRole("link", { name: /Segun Bello/ }).click();
  await expect(page.getByText(/••• ••• 0147/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Call" })).toHaveCount(0);
  // Streaming pages send the not-found page with status 200; the content is what matters.
  for (const path of ["/app/reports", "/app/whatsapp", "/app/whatsapp/approve"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
    await expect(page.getByText("This page could not be found")).toBeVisible();
  }
});

test("receptionists can't open reports or settings", async ({ page }) => {
  await signIn(page, "reception@sharpandco.test");
  for (const path of ["/app/reports", "/app/settings", "/app/whatsapp/approve"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
    await expect(page.getByText("This page could not be found")).toBeVisible();
  }
});

test("US-11 customer reschedules and then cancels from their link", async ({ page }, info) => {
  await page.goto("/sharpandco");
  await page.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Name").fill("Mover Person");
  await page.getByLabel("WhatsApp number").fill(`0803 777 010${deviceNo(info)}`);
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /You're booked, Mover/ })).toBeVisible();
  const firstUrl = page.url();

  await page.getByRole("button", { name: "Reschedule" }).click();
  await page.getByRole("radiogroup", { name: "New date" }).getByRole("radio").nth(2).click();
  await page.getByRole("radiogroup", { name: "New time" }).getByRole("radio", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByRole("button", { name: "Move booking" }).click();
  await expect(page).not.toHaveURL(firstUrl);
  await expect(page.getByRole("heading", { name: /You're booked, Mover/ })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
});

test("US-01 a new owner signs up and lands on their dashboard", async ({ page }, info) => {
  const email = `new-owner-${info.project.name}-${Date.now()}@example.test`;
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("New Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password-1");
  await page.getByLabel("Salon name").fill("Fresh Fade Studio");
  await page.getByLabel("Country").selectOption("GB");
  await page.getByRole("button", { name: "Create salon" }).click();
  await expect(page).toHaveURL(/\/app\?welcome=1/);
  await expect(page.getByText("Welcome! Three things to finish setting up")).toBeVisible();
  await page.goto("/app/settings");
  await expect(page.getByText("£20")).toBeVisible(); // starter prices in the salon's currency
});

test("NFR-ACC: main staff screens have no serious accessibility violations", async ({ page }) => {
  await signIn(page, "owner@sharpandco.test");
  const found: string[] = [];
  for (const path of ["/app", "/app/calendar", "/app/customers", "/app/payments", "/app/whatsapp", "/app/whatsapp/approve", "/app/reports", "/app/settings", "/app/walk-in"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    for (const v of result.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
      found.push(`${path} ${v.id}: ${v.help} e.g. ${v.nodes[0]?.target.join(" ")}`);
    }
  }
  expect(found).toEqual([]);
});
