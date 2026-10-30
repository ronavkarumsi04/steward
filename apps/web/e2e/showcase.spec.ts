import { test, expect, type Page } from "@playwright/test";
import { watchErrors, networkSettled } from "./session";

/** The carbon copy currently on top of the stack. */
const frontCopy = (page: Page) =>
  page.locator("article[data-copy]").evaluateAll((sheets) => {
    const ranked = sheets.map((sheet) => [sheet.getAttribute("data-copy"), Number(getComputedStyle(sheet).zIndex)] as const);
    return [...ranked].sort((a, b) => b[1] - a[1])[0]?.[0];
  });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("the hero order signs straight into the entry flow with the email carried over", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Agents do the work\.\s*You keep the record\./);
  const email = page.locator("#hero-email");
  await expect(email).toBeInViewport();
  await email.fill("founder@example.com");
  await email.press("Enter");
  await expect(page).toHaveURL(/\/(register|login)\?email=founder%40example\.com$/);
  await expect(page.locator("#email")).toHaveValue("founder@example.com");
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("carbon copies come forward by pointer and by keyboard", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect.poll(() => frontCopy(page)).toBe("work");
  await page.getByRole("radio", { name: /canary copy/i }).check();
  await expect.poll(() => frontCopy(page)).toBe("approval");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /pink copy/i })).toBeChecked();
  await expect.poll(() => frontCopy(page)).toBe("record");
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("without JavaScript the whole pad works: copies switch, destinations resolve, nothing overflows", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // Chromium intentionally refuses the document's script preload when JavaScript is disabled.
  const errors = watchErrors(page, { expect: [{ method: "GET", path: /^\/_next\/static\/.*\.js$/, reason: "csp" }] });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-motion]")).toHaveAttribute("data-motion", "false");
  await page.getByRole("radio", { name: /pink copy/i }).check();
  await expect.poll(() => frontCopy(page)).toBe("record");
  await expect(page.getByRole("link", { name: "API reference" }).first()).toHaveAttribute("href", "/api/v1/openapi.json");
  await expect(page.locator("#workspace tbody tr")).toHaveCount(10);
  expect(await overflow(page)).toBe(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("on a phone the order reads top to bottom with the entry action and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  await expect(page.getByRole("link", { name: /create your company|enter workspace/i }).first()).toBeInViewport();
  expect(await overflow(page)).toBe(0);
  const positions = await page.locator("#how, #workspace, #conditions").evaluateAll((sections) => sections.map((s) => s.getBoundingClientRect().top));
  expect(positions[1]).toBeGreaterThan(positions[0]!);
  expect(positions[2]).toBeGreaterThan(positions[1]!);
  await networkSettled(page);
  expect(errors).toEqual([]);
});
