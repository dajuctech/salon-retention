import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { humanPause, deviceNo } from "./helpers";

const TIME = /^\d{2}:\d{2}$/;

/** Fails the test on any browser console error or uncaught exception. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function waitForSlots(page: Page) {
  await expect(page.getByRole("radiogroup", { name: "Time" })).toHaveAttribute("aria-busy", "false");
}

test("home links to the salon booking page", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Sharp & Co\. booking page/ }).click();
  await expect(page.getByRole("heading", { name: "Book your cut" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("book a chosen barber with offers consent, then the slot shows as taken", async ({ page }, info) => {
  const errors = watchConsole(page);
  await page.goto("/sharpandco");
  await page.getByRole("radio", { name: /Haircut \+ Beard/ }).click();
  await page.getByRole("radio", { name: /Chidi/ }).click();
  await waitForSlots(page);

  const slot = page.getByRole("radio", { name: TIME }).first();
  const time = (await slot.textContent())!.trim();
  await slot.click();
  await expect(page.getByText(new RegExp(`Haircut \\+ Beard · Chidi · .*${time}`))).toBeVisible();

  await page.getByLabel("Name").fill(`E2E ${info.project.name}`);
  await page.getByLabel("WhatsApp number").fill(`0803 900 000${deviceNo(info)}`);
  await page.getByRole("checkbox", { name: /occasional offers/ }).check();
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.getByRole("heading", { name: "You're booked, E2E" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Chidi");
  await expect(page.getByRole("main")).toContainText("Haircut + Beard · 45 min");
  await expect(page.getByRole("main")).toContainText("₦4,500");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to my calendar" }).click();
  expect((await download).suggestedFilename()).toBe("booking.ics");

  // Persistence: the same barber and time are now unavailable.
  await page.getByRole("link", { name: "Book another time" }).click();
  await page.getByRole("radio", { name: /Haircut \+ Beard/ }).click();
  await page.getByRole("radio", { name: /Chidi/ }).click();
  await waitForSlots(page);
  await expect(page.getByRole("radio", { name: `${time}, unavailable` })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("two customers race for the same slot: one wins, the other is told and can re-pick", async ({ browser }, info) => {
  const [ctxA, ctxB] = await Promise.all([browser.newContext(info.project.use), browser.newContext(info.project.use)]);
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  for (const p of [a, b]) {
    await p.goto("/sharpandco");
    await p.getByRole("radio", { name: /Tunde/ }).click();
    await waitForSlots(p);
  }
  const time = (await a.getByRole("radio", { name: TIME }).first().textContent())!.trim();
  const suffix = deviceNo(info);
  for (const [p, n] of [
    [a, `080390010${suffix}1`],
    [b, `080390010${suffix}2`],
  ] as const) {
    await p.getByRole("radio", { name: time, exact: true }).click();
    await p.getByLabel("Name").fill("Racer");
    await p.getByLabel("WhatsApp number").fill(n);
  }
  await humanPause(a);
  await Promise.all([
    a.getByRole("button", { name: "Confirm booking" }).click(),
    b.getByRole("button", { name: "Confirm booking" }).click(),
  ]);

  const booked = a.getByRole("heading", { name: "You're booked, Racer" });
  const bookedB = b.getByRole("heading", { name: "You're booked, Racer" });
  await expect(booked.or(a.getByText("Someone just booked that time"))).toBeVisible();
  await expect(bookedB.or(b.getByText("Someone just booked that time"))).toBeVisible();
  const winners = (await booked.count()) + (await bookedB.count());
  expect(winners).toBe(1);

  const loser = (await booked.count()) ? b : a;
  await expect(loser.getByRole("radio", { name: `${time}, unavailable` })).toBeDisabled();
  await Promise.all([ctxA.close(), ctxB.close()]);
});

test("unknown salon shows the not-found page", async ({ page }) => {
  await page.goto("/no-such-salon");
  await expect(page.getByText("This page could not be found")).toBeVisible();
});

test("NFR-ACC: booking and confirmation pages have no serious accessibility violations", async ({ page }, info) => {
  await page.goto("/sharpandco");
  await waitForSlots(page);
  const booking = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

  await page.getByRole("radio", { name: TIME }).last().click();
  await page.getByLabel("Name").fill("Axe Check");
  await page.getByLabel("WhatsApp number").fill(`0803 900 020${deviceNo(info)}`);
  await humanPause(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /You're booked/ })).toBeVisible();
  const confirmation = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

  const serious = [...booking.violations, ...confirmation.violations]
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(serious).toEqual([]);
});
