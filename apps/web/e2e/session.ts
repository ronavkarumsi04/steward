import { expect, type Page } from "@playwright/test";

/** These suites are disposable: every run registers its own account, so no test depends on another's data. */
export const PASSWORD = "correct-horse-battery-staple";

/**
 * Register a fresh account and return its email.
 *
 * Registration is clickwrap-gated: the submit button stays disabled until the current terms, privacy and
 * acceptable-use documents are accepted, so a test that skips this would hang on a disabled button.
 */
export async function register(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Founder");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("checkbox", { name: /I agree to the/i }).check();
  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL(/\/app(\/new)?$/);
  return email;
}

/**
 * Create a company through the real onboarding, and return its id.
 *
 * Onboarding is three steps with server-side validation (the idea has to be a few words, the autonomy level has
 * to be chosen), so a test that needs a company goes through the same flow a founder does rather than inserting
 * rows behind the product's back.
 */
export async function createCompany(page: Page, name: string, idea = "A weekly analytics digest for small online stores."): Promise<string> {
  await page.waitForURL(/\/app(\/new)?$/);
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("The idea, in your own words").fill(idea);
  await page.getByLabel("Target customers (comma-separated)").fill("Shopify store owners, DTC marketers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL(/\/app\/c\/([0-9a-f-]+)$/);
  const id = /\/app\/c\/([0-9a-f-]+)$/.exec(page.url())?.[1];
  if (!id) throw new Error(`Could not read the company id out of ${page.url()}`);
  return id;
}

/**
 * Open the company command palette from the keyboard, and prove the shortcut works.
 *
 * The shortcut listener attaches when the shell hydrates, and after a hard reload that can lag the first paint
 * by a moment — so a single press can land before anything is listening, which fails for a reason that has
 * nothing to do with the shortcut. Pressing again is what a person would do; a listener that never attached
 * still fails here rather than passing by accident.
 */
export async function openCompanyPalette(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Company command palette" });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Uncaught exceptions are never acceptable, whatever the page is doing.
 *
 * Resource-loading noise is filtered out because a missing image or a favicon is a broken asset, not a broken
 * runtime, and this suite is about the runtime; the golden path covers the surfaces where an asset matters.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|net::ERR_/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}
