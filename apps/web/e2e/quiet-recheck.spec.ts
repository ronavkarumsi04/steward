import { expect, test, type Page } from "@playwright/test";
import { BrowserService } from "@steward/core";
import { FakeBrowserProvider } from "@steward/core/test/fake-browser";
import { openSeedDb, seedScope } from "./seed";
import { networkSettled, register, watchErrors } from "./session";

test.skip(process.env.STEWARD_WORKSPACE_SHELL !== "quiet", "Requires an explicitly opted-in Quiet web process.");

async function idleCompany(page: Page) {
  await register(page);
  const meResponse = await page.request.get("/api/v1/auth/me");
  expect(meResponse.ok()).toBe(true);
  const me = await meResponse.json() as { memberships: { organizationId: string }[] };
  const orgId = me.memberships[0]!.organizationId;
  // No launch-kit run or paid model calls for a layout/keyboard regression.
  const response = await page.request.post(`/api/v1/orgs/${orgId}/companies`, {
    headers: { origin: new URL(page.url()).origin },
    data: { name: "Quiet recheck", autonomyLevel: 1 },
  });
  expect(response.ok()).toBe(true);
  const { company } = await response.json() as { company: { id: string } };
  return { companyId: company.id, orgId };
}

for (const width of [320, 390]) {
  test(`section pickers retain keyboard focus at ${width}px`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const { companyId, orgId } = await idleCompany(page);
    for (const path of ["/app/account", `/app/org/${orgId}/privacy`, `/app/c/${companyId}/settings`, "/app/design"]) {
      await page.goto(path);
      const picker = page.locator(".q-depth-section-picker");
      const summary = picker.locator("summary");
      await expect(summary).toBeVisible();
      await summary.focus();
      await summary.press("Enter");
      await expect(picker).toHaveAttribute("open", "");
      await summary.press("Tab");
      await expect(picker.getByRole("link").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(picker).not.toHaveAttribute("open");
      await expect(summary).toBeFocused();
      await summary.press("Enter");
      await summary.press("Escape");
      await expect(picker).not.toHaveAttribute("open");
      await expect(summary).toBeFocused();
      await summary.press("Enter");
      await summary.press("Tab");
      await page.keyboard.press("Tab");
      const link = picker.getByRole("link").nth(1);
      await expect(link).toBeFocused();
      const hash = await link.getAttribute("href");
      expect(hash).toMatch(/^#/);
      await page.keyboard.press("Enter");
      await expect(picker).not.toHaveAttribute("open");
      await expect(page.locator(hash!)).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
      await expect.poll(() => page.locator(hash!).evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
      // Tab must continue from the destination, not restart at the page's first control.
      await page.keyboard.press("Tab");
      expect(await page.locator(hash!).evaluate((element) => Boolean(element.compareDocumentPosition(document.activeElement!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    }
    await networkSettled(page);
    expect(errors).toEqual([]);
  });

  test(`captured Browser steps contain URLs in live and ended sessions at ${width}px`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const { companyId } = await idleCompany(page);
    const seed = openSeedDb();
    const provider = new FakeBrowserProvider();
    const browser = new BrowserService(seed.db, provider);
    try {
      const scope = await seedScope(seed, companyId, { role: "owner" });
      for (const ended of [false, true]) {
        const url = ended ? `https://example.com/${"long-path-segment".repeat(12)}` : "https://example.com/";
        const opened = await browser.open(scope, { url, purpose: "Quiet captured-frame regression" });
        if (ended) await browser.close(scope, opened.session.id);
        await page.goto(`/app/c/${companyId}/browser?session=${opened.session.id}`);
        await expect(page.getByTestId("browser-frame")).toBeVisible();
        await expect.poll(() => page.getByTestId("browser-frame").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
        await expect(page.getByTestId("browser-steps")).toContainText(`Open ${url}`);
        // A root text preference is a fast regression check, not a substitute for
        // the separate native Firefox 200% text-only acceptance run.
        await page.evaluate(() => { document.documentElement.style.fontSize = "30px"; });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        const steps = page.getByTestId("browser-steps").getByRole("button");
        await expect(steps).toHaveCount(1);
        expect(await steps.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    } finally {
      await provider.dispose();
      await seed.close();
    }
    await networkSettled(page);
    expect(errors).toEqual([]);
  });
}
