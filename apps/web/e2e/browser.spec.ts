import { expect, test } from "@playwright/test";
import { createCompany, register, watchErrors } from "./session";

/**
 * The browser page's first run.
 *
 * What a founder must be able to check before anything has happened is whether this deployment can open a page at
 * all. The page answers that in one of two ways and both are asserted here, because a stack can legitimately be
 * either: an installation with Chromium offers the form, and one without says so in a sentence and explains what to
 * install — never a form that would fail on submit. The test reads which case it is and holds the page to the
 * promise of that case, rather than assuming the machine it runs on.
 *
 * A session with frames, a step log and a stop is covered elsewhere: the API suite drives the routes against a
 * provider it controls, and `browser-live.spec.ts` drives the same provider while watching the real page, which is
 * the only way to tell a stream that works from a stream that is merely connected.
 */
test.describe.configure({ mode: "serial" });

test("says whether it has a browser, and offers only what that allows", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const companyId = await createCompany(page, "Browser E2E");

  // The company's own sidebar is how a founder reaches it, and it marks where they are.
  const link = page.getByRole("link", { name: "Browser", exact: true });
  await link.click();
  await page.waitForURL(new RegExp(`/app/c/${companyId}/browser$`));
  await expect(link).toHaveAttribute("aria-current", "page");

  await expect(page.getByRole("heading", { level: 1, name: "Watch an agent use a browser" })).toBeVisible();
  // Nothing has been looked at yet, and the page says so instead of showing an empty viewer with no explanation.
  await expect(page.getByText(/No sessions yet/)).toBeVisible();

  const missing = await page.getByText("No browser on this deployment").isVisible();
  const url = page.getByTestId("browser-url");
  const start = page.getByTestId("browser-start");

  if (missing) {
    // The reason travels with the page, and the form is not offered as a control that cannot work.
    await expect(page.getByText(/no browser provider configured|Chromium/i)).toBeVisible();
    await expect(page.getByText(/Nothing will open on this deployment until a browser is installed/)).toBeVisible();
    await expect(url).toBeDisabled();
    await expect(start).toBeDisabled();
  } else {
    // With a browser, the form is live and refuses to submit nothing: an address is what makes it possible.
    await expect(url).toBeEnabled();
    await expect(start).toBeDisabled();
    await url.fill("https://example.com/pricing");
    await expect(start).toBeEnabled();
    await expect(page.getByTestId("browser-agent")).toBeEnabled();
    // The agent select is populated from the company's own agents rather than a hard-coded list.
    await expect(page.getByTestId("browser-agent").locator("option")).not.toHaveCount(0);
    // The instruction is not sent until the founder asks for it, so nothing has run.
    await expect(page.getByTestId("browser-run")).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});

test("fits a phone without scrolling sideways", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const companyId = await createCompany(page, "Browser Phone");

  await page.goto(`/app/c/${companyId}/browser`);
  await expect(page.getByRole("heading", { level: 1, name: "Watch an agent use a browser" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send an agent to look/ })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // A page that fits is only worth having if it also ran: the width was measured on a live page.
  expect(errors).toEqual([]);
});
