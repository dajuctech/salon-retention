import { defineConfig, devices } from "@playwright/test";

// E2E tests (docs/testing-strategy.md). Expects the app on BASE_URL (default: pnpm dev on :3000)
// with the demo salon seeded (pnpm db:seed). Runs on an Android-like phone (Chromium), an iPhone
// (WebKit, i.e. Safari's engine) and a desktop (NFR-COMPAT).
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  // Tests share one database and book real slots, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000" },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
});
