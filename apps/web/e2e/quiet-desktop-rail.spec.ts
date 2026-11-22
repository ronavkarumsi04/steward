import { expect, test, type Page } from "@playwright/test";
import { networkSettled, register, watchErrors } from "./session";

async function expectPinnedRail(page: Page) {
  await expect.poll(() => page.locator(".quiet-rail").evaluate((rail) => {
    const box = rail.getBoundingClientRect();
    const header = document.querySelector(".quiet-topbar")!.getBoundingClientRect();
    return {
      headerVisible: Math.abs(header.top) < 1,
      railBelowHeader: Math.abs(box.top - header.bottom) <= 1,
      railFitsViewport: Math.abs(box.bottom - window.innerHeight) <= 1,
      railWidthPreserved: box.width === 224,
      noHorizontalRailOverflow: rail.scrollWidth <= rail.clientWidth,
    };
  })).toEqual({ headerVisible: true, railBelowHeader: true, railFitsViewport: true, railWidthPreserved: true, noHorizontalRailOverflow: true });
}

async function expectRailContentsReachable(page: Page) {
  const rail = page.locator(".quiet-rail");
  const pageScroll = await page.evaluate(() => window.scrollY);
  const links = rail.locator("a");
  await links.first().focus();
  // Tab through actual navigation, not a synthetic focusable scroll container.
  // Focus must reveal each link inside the rail without losing the page's place.
  for (let index = 0; index < await links.count(); index++) {
    const link = links.nth(index);
    await expect(link).toBeFocused();
    await expect.poll(() => link.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const scroller = element.closest(".quiet-rail")!.getBoundingClientRect();
      return box.top >= scroller.top - 1 && box.bottom <= scroller.bottom + 1;
    })).toBe(true);
    if (index + 1 < await links.count()) await page.keyboard.press("Tab");
  }
  // The authority text after Settings must also remain readable by scrolling.
  await rail.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => rail.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const authority = element.querySelector(".quiet-authority")!.getBoundingClientRect();
    return authority.top >= box.top && authority.bottom <= box.bottom + 1;
  })).toBe(true);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - pageScroll)).toBeLessThanOrEqual(1);
}

test("Quiet desktop navigation stays in view on long pages and scrolls within short windows", async ({ page }) => {
  test.skip(process.env.STEWARD_WORKSPACE_SHELL !== "quiet", "Requires an explicitly opted-in Quiet web process; legacy stays the default.");
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page);
  // An idle company is enough for layout; onboarding would start a launch-kit run.
  const meResponse = await page.request.get("/api/v1/auth/me");
  expect(meResponse.ok()).toBe(true);
  const me = await meResponse.json() as { memberships: { organizationId: string }[] };
  const created = await page.request.post(`/api/v1/orgs/${me.memberships[0]!.organizationId}/companies`, {
    headers: { origin: new URL(page.url()).origin },
    data: { name: "Quiet rail persistence", autonomyLevel: 1 },
  });
  expect(created.ok()).toBe(true);
  const { company } = await created.json() as { company: { id: string } };
  await page.goto(`/app/c/${company.id}/settings`);
  const policies = page.getByRole("heading", { name: "Policies", exact: true });
  await expect(policies).toBeVisible();
  const rail = page.locator(".quiet-rail");

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await policies.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await expectPinnedRail(page);
    await expect(rail.getByRole("link", { name: "Overview", exact: true })).toBeInViewport();
    await expect(rail.getByRole("link", { name: "Settings", exact: true })).toBeInViewport();
    await expectRailContentsReachable(page);
  }

  await page.setViewportSize({ width: 1440, height: 480 });
  // Root enlargement is deterministic CI stress, not native browser text zoom.
  // Native Firefox 200% text-only and full-page 400% are checked separately.
  await page.evaluate(() => { document.documentElement.style.fontSize = "30px"; });
  await policies.scrollIntoViewIfNeeded();
  await expectPinnedRail(page);
  expect(await rail.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expectRailContentsReachable(page);
  await expectPinnedRail(page);

  await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rail).toBeHidden();
  await expect(page.locator(".quiet-bottom")).toBeVisible();
  await policies.scrollIntoViewIfNeeded();
  // The desktop-only sticky header must not alter the phone's document scroll.
  expect(await page.locator(".quiet-topbar").evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
});
