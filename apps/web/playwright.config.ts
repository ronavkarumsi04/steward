import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against an already-running stack (API on :4000 + web on :3000 by default) so the same
 * suite works for local dev, `scripts/verify-boot.sh`, and CI. Set E2E_BASE_URL / E2E_API_URL to point elsewhere.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
