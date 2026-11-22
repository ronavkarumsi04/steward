import { expect, test, type Page } from "@playwright/test";
import { networkSettled, register, watchErrors } from "./session";

async function assertNavigationFits(page: Page, rows: "one" | "multiple") {
  const nav = page.locator(".quiet-bottom");
  await expect(nav).toBeVisible();
  await expect(nav.locator(":scope > a")).toHaveCount(4);
  await expect(nav.locator(":scope > button")).toHaveText("More");
  await expect.poll(() => nav.evaluate((element) => {
    const bar = element.getBoundingClientRect();
    const content = document.querySelector(".quiet-content")!;
    return parseFloat(getComputedStyle(content).paddingBottom) >= bar.height + 23;
  })).toBe(true);
  const layout = await nav.evaluate((element) => {
    const controls = [...element.querySelectorAll<HTMLElement>(":scope > a, :scope > button")];
    const boxes = controls.map((control) => control.getBoundingClientRect());
    return {
      rows: new Set(boxes.map((box) => Math.round(box.top))).size,
      labels: controls.map((control) => control.lastElementChild!.textContent),
      wholeLabels: controls.every((control, index) => {
        const label = control.lastElementChild!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const rects = [...range.getClientRects()];
        const box = boxes[index]!;
        return rects.length === 1 && rects.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1)
          && parseFloat(getComputedStyle(label).fontSize) >= 12;
      }),
      noOverlap: boxes.every((a, index) => boxes.slice(index + 1).every((b) =>
        a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)),
      badgeClear: controls.every((control) => {
        const badge = control.querySelector(".quiet-mobile-count")?.getBoundingClientRect();
        const label = control.lastElementChild!.getBoundingClientRect();
        const box = control.getBoundingClientRect();
        return !badge || (badge.bottom <= label.top && badge.left >= box.left && badge.right <= box.right);
      }),
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(layout.labels).toEqual(["Overview", "Approvals", "Work", "Team", "More"]);
  expect(layout.wholeLabels).toBe(true);
  expect(layout.noOverlap).toBe(true);
  expect(layout.badgeClear).toBe(true);
  expect(layout.noOverflow).toBe(true);
  if (rows === "one") expect(layout.rows).toBe(1);
  else expect(layout.rows).toBeGreaterThan(1);
}

test("Quiet mobile navigation reflows whole labels and reserves its changing height", async ({ page }) => {
  test.skip(process.env.STEWARD_WORKSPACE_SHELL !== "quiet", "Requires an explicitly opted-in Quiet web process; legacy stays the default.");
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  // Onboarding also starts a launch-kit run. Create only the idle company through
  // the same product API instead: this layout test must not start runs or approvals.
  const meResponse = await page.request.get("/api/v1/auth/me");
  expect(meResponse.ok()).toBe(true);
  const me = await meResponse.json() as { memberships: { organizationId: string }[] };
  const created = await page.request.post(`/api/v1/orgs/${me.memberships[0]!.organizationId}/companies`, {
    headers: { origin: new URL(page.url()).origin },
    data: { name: "Quiet label reflow", autonomyLevel: 1 },
  });
  expect(created.ok()).toBe(true);
  const { company } = await created.json() as { company: { id: string } };
  await page.goto(`/app/c/${company.id}`);
  // This regression targets the opt-in Quiet web process, never legacy's default.
  await assertNavigationFits(page, "one");
  const nav = page.locator(".quiet-bottom");
  const compactHeight = await nav.evaluate((element) => element.getBoundingClientRect().height);
  expect(compactHeight).toBeLessThan(90);

  // Presentation-only fixture: exercise the real badge class without creating
  // an approval (or a run). Native browser acceptance uses the same explicit fixture.
  await nav.locator(":scope > a").nth(1).locator(".quiet-nav-icon").evaluate((element) => {
    const badge = document.createElement("span");
    badge.className = "quiet-mobile-count";
    badge.textContent = "3";
    element.append(badge);
  });

  // Deterministic font-only stress for Chromium CI, not a substitute for native
  // Firefox 200% text-only zoom in the recorded browser acceptance check.
  await nav.locator(":scope > a, :scope > button").evaluateAll((controls) => {
    const sizes = controls.map((control) => parseFloat(getComputedStyle(control).fontSize));
    controls.forEach((control, index) => { (control as HTMLElement).style.fontSize = `${sizes[index]! * 2}px`; });
  });
  await nav.locator(".quiet-mobile-count").evaluate((element) => {
    const style = getComputedStyle(element);
    const size = parseFloat(style.fontSize) * 2;
    const leading = parseFloat(style.lineHeight) * 2;
    (element as HTMLElement).style.fontSize = `${size}px`;
    (element as HTMLElement).style.lineHeight = `${leading}px`;
  });
  await assertNavigationFits(page, "multiple");
  expect(await nav.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(compactHeight);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.locator(".quiet-content").evaluate((element) =>
    element.lastElementChild!.getBoundingClientRect().bottom <= document.querySelector(".quiet-bottom")!.getBoundingClientRect().top - 23,
  )).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  await assertNavigationFits(page, "multiple");
  await nav.locator(":scope > a, :scope > button").evaluateAll((controls) => {
    controls.forEach((control) => { (control as HTMLElement).style.removeProperty("font-size"); });
  });
  await nav.locator(".quiet-mobile-count").evaluate((element) => { element.remove(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNavigationFits(page, "one");
  await expect.poll(() => nav.evaluate((element) => element.getBoundingClientRect().height)).toBe(compactHeight);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(nav).toBeHidden();
  await expect(page.locator(".quiet-rail")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--workspace-bottom-height"))).toBe("0px");
  await page.goto("/app");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--workspace-bottom-height"))).toBe("");
  await networkSettled(page);
  expect(errors).toEqual([]);
});
