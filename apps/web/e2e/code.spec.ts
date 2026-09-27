import { expect, test } from "@playwright/test";
import { createCompany, register, watchErrors } from "./session";

/**
 * The code IDE's first run.
 *
 * Every other surface in this product degrades by showing less; the IDE has one state it must not fake. It reads a
 * repository through a source-control integration, so with none connected there is nothing to read, and the page
 * has to say exactly that rather than render an empty file tree, an editor over nothing, or a "Run tests" button
 * on a stack with no sandbox. That is what these two cases are for: the honest first state, and the fact that the
 * page fits the phone a founder reads it on.
 *
 * A run that *does* have a GitHub connection is covered by the API suite, which drives the same routes against a
 * local source-control server it can control; a hosted GitHub is not something a browser test should depend on.
 */
test.describe.configure({ mode: "serial" });

test("with no source control connected, the page says what to connect and offers nothing false", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const companyId = await createCompany(page, "Code IDE E2E");

  // The company's own sidebar is how a founder reaches it, and it marks where they are.
  const link = page.getByRole("link", { name: "Code", exact: true });
  await link.click();
  await page.waitForURL(new RegExp(`/app/c/${companyId}/code$`));
  await expect(link).toHaveAttribute("aria-current", "page");

  // The explanation names the actual dependency and links to where it is resolved.
  await expect(page.getByRole("heading", { level: 1, name: "Code" })).toBeVisible();
  await expect(page.getByText(/reads your repository directly rather than keeping a copy/i)).toBeVisible();
  // Scoped to the page body: the org switcher and the company sidebar both have an Integrations link too.
  const integrations = page.getByRole("main").getByRole("link", { name: "Integrations" });
  await expect(integrations).toBeVisible();
  await expect(integrations).toHaveAttribute("href", `/app/c/${companyId}/integrations`);

  // Nothing that would edit, commit or run is offered while there is no repository behind it.
  await expect(page.getByRole("button", { name: /stage change/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /apply session/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /run tests/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Files" })).toHaveCount(0);

  // It navigates without a single uncaught error or console error from the app itself.
  expect(errors).toEqual([]);
});

test("fits a phone without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const companyId = await createCompany(page, "Code IDE Phone");

  await page.goto(`/app/c/${companyId}/code`);
  await expect(page.getByRole("heading", { level: 1, name: "Code" })).toBeVisible();
  await expect(page.getByText(/Connect one under/i)).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
