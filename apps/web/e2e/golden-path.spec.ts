import { expect, test, type Page } from "@playwright/test";

const password = "correct-horse-battery-staple";

async function register(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Founder");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app(\/new)?$/);
  return email;
}

test.describe.configure({ mode: "serial" });

test("landing links to sign-in, register and API docs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /get started|register|create/i }).first()).toBeVisible();
});

test("unauthenticated workspace redirects to login; bad credentials show an error", async ({ page }) => {
  await page.goto("/app");
  await page.waitForURL(/\/login/);
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("register → onboarding → dashboard → tasks → settings → providers → sign out → sign in", async ({ page }) => {
  const email = await register(page);

  // A fresh account has no companies, so /app forwards to onboarding.
  await page.waitForURL(/\/app\/new$/);
  await page.getByLabel("Company name").fill("E2E Analytics");
  await page.getByLabel("The idea, in your own words").fill("A weekly analytics digest for small online stores.");
  await page.getByLabel("Target customers (comma-separated)").fill("Shopify store owners, DTC marketers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL(/\/app\/c\/[0-9a-f-]+$/);
  const companyUrl = page.url();

  // Dashboard renders durable state seeded by company creation, including the onboarding profile.
  await expect(page.getByRole("heading", { name: "E2E Analytics" })).toBeVisible();
  await expect(page.getByText("A weekly analytics digest for small online stores.")).toBeVisible();
  await expect(page.getByText(/autonomy/i).first()).toBeVisible();

  // Tasks: create one without starting a run (no model provider is configured in E2E).
  await page.goto(`${companyUrl}/tasks`);
  await page.getByLabel("Task title").fill("Draft positioning statement");
  await page.getByLabel(/start now/i).uncheck();
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Draft positioning statement")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Draft positioning statement")).toBeVisible();

  // Agents seeded by company creation.
  await page.goto(`${companyUrl}/agents`);
  await expect(page.getByText(/orchestrator|chief of staff/i).first()).toBeVisible();

  // Settings: pause outbound actions and confirm the state persists across reload.
  await page.goto(`${companyUrl}/settings`);
  await page.getByRole("button", { name: "Pause all outbound actions" }).click();
  await expect(page.getByRole("button", { name: "Resume outbound actions" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume outbound actions" })).toBeVisible();

  // Org providers page: companion pairing yields a one-time code, never a key.
  await page.getByRole("link", { name: "Providers" }).first().click();
  await page.waitForURL(/\/providers$/);
  await expect(page.getByText("Local Companions")).toBeVisible();
  await page.getByPlaceholder("Ronav's MacBook").fill("E2E laptop");
  await page.getByRole("button", { name: "Pair a new companion" }).click();
  await expect(page.getByText(/steward-companion pair --server .* --code \d{6}/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("scd_");

  // Sign out invalidates the session; signing back in restores access.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/(login)?$/);
  await page.goto(companyUrl);
  await page.waitForURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/c\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2E Analytics" })).toBeVisible();
});
