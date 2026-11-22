import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PASSWORD, networkSettled, watchErrors } from "./session";

test("closed signup → waitlist → operator admission → founder registration", async ({ page, browser }) => {
  test.skip(process.env.E2E_WAITLIST !== "1", "Requires a closed-signup stack and E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD");
  const operatorEmail = process.env.E2E_OPERATOR_EMAIL;
  const operatorPassword = process.env.E2E_OPERATOR_PASSWORD;
  expect(operatorEmail).toBeTruthy();
  expect(operatorPassword).toBeTruthy();
  const errors = watchErrors(page, { expect: [{ method: "POST", path: "/api/v1/waitlist", status: 429 }, { method: "POST", path: "/api/v1/auth/register", status: 400 }] });
  const screenshots = process.env.E2E_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const capture = async (name: string, target = page) => {
    if (screenshots) await target.screenshot({ path: `${screenshots}/${name}.png`, fullPage: true, animations: "disabled" });
  };
  const email = `waitlist-browser-${Date.now()}@example.com`;
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Steward is invite-only right now" })).toBeVisible();
  await capture("register-closed");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Your name").fill("Beta Founder");
  await page.getByLabel("What would you like to build?").fill("A calm workspace for a small research studio.");
  await page.route("**/api/v1/waitlist", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }) }), { times: 1 });
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeVisible();
  await capture("waitlist-joined");

  const operator = await browser.newContext({ baseURL: new URL(page.url()).origin, permissions: ["clipboard-read", "clipboard-write"] });
  try {
    const admin = await operator.newPage();
    const adminErrors = watchErrors(admin);
    await admin.goto("/login");
    await admin.getByLabel("Email", { exact: true }).fill(operatorEmail!);
    await admin.getByLabel("Password", { exact: true }).fill(operatorPassword!);
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await admin.waitForURL(/\/app(\/new)?$/);
    await admin.goto("/app/admin/waitlist");
    const agreements = admin.getByRole("dialog");
    if (await agreements.isVisible()) {
      await agreements.getByRole("checkbox").check();
      await agreements.getByRole("button", { name: "Accept and continue" }).click();
      await expect(agreements).not.toBeVisible();
    }
    const row = admin.getByRole("row").filter({ hasText: email });
    await row.getByRole("button", { name: "Admit", exact: true }).click();
    await expect(row.getByRole("status")).toContainText(/emailed/i);
    const link = await row.getByLabel(`Admission link for ${email}`).inputValue();
    expect(link).toContain("/register?waitlist=");
    await row.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(row.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await capture("admin-waitlist-admitted", admin);

    await page.goto(link);
    await expect(page.getByText("Your beta spot is ready.", { exact: false })).toBeVisible();
    await page.getByLabel("Your name").fill("Beta Founder");
    await page.getByLabel("Email", { exact: true }).fill(`wrong-${Date.now()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("checkbox", { name: /I agree to the/i }).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Use the email address that received this waitlist invitation.", { exact: true })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForURL(/\/app(\/new)?$/);
    await admin.reload();
    await expect(admin.getByRole("row").filter({ hasText: email })).toContainText("Account created");
    await networkSettled(page);
    await networkSettled(admin);
    expect(errors).toEqual([]);
    expect(adminErrors).toEqual([]);
  } finally {
    await operator.close();
  }
});
