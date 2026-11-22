import { expect, test, type Page } from "@playwright/test";
import { createCompany, networkSettled, openCompanyPalette, register, watchErrors } from "./session";

async function openFreshPalette(page: Page) {
  await register(page);
  // No work is required to test keyboard recovery; keep the launch request inert.
  await page.route(/\/companies\/[^/]+\/launch-kit$/, (route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ run: null }) }),
  );
  const companyId = await createCompany(page, "Palette keyboard");
  await openCompanyPalette(page);
  const dialog = page.getByRole("dialog", { name: "Company command palette" });
  await expect(dialog.getByText(/nothing awaiting a decision/)).toBeVisible();
  return { companyId, dialog, input: dialog.getByRole("combobox") };
}

test("a refused instruction keeps keyboard focus and Escape backs out one step", async ({ page }) => {
  const errors = watchErrors(page, { expect: [{ method: "POST", path: /\/api\/v1\/companies\/[^/]+\/runs$/, status: 503 }] });
  const { companyId, dialog, input } = await openFreshPalette(page);
  let attempts = 0;
  await page.route(new RegExp(`/api/v1/companies/${companyId}/runs$`), (route) => {
    attempts += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "Please retry this instruction." } }) });
  });
  await input.fill("Prepare a local research outline");
  await input.press("Enter");
  const confirm = dialog.getByRole("button", { name: "Start the run" });
  await expect(confirm).toBeVisible();
  expect(attempts).toBe(0);
  await confirm.click();
  await expect(dialog.getByRole("alert")).toHaveText("Please retry this instruction.");
  await expect(confirm).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Prepare a local research outline");
  expect(attempts).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(confirm).toBeHidden();
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("keyboard selection scrolls into a short results viewport", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 500 });
  const { dialog, input } = await openFreshPalette(page);
  await input.fill("");
  for (let i = 0; i < 9; i += 1) await input.press("ArrowDown");
  const selected = dialog.getByRole("option", { selected: true });
  await expect.poll(() => selected.evaluate((option) => {
    const results = option.parentElement!;
    const bounds = results.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    // Native scroll offsets round to pixels; tolerate only that subpixel remainder.
    return results.scrollTop > 0 && item.top >= bounds.top - 1 && item.bottom <= bounds.bottom + 1;
  })).toBe(true);
  await networkSettled(page);
  expect(errors).toEqual([]);
});
