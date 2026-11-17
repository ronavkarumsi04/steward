import { expect, test } from "@playwright/test";
import { PASSWORD, networkSettled, register, watchErrors } from "./session";

test("Account security confirms sign-out and revokes sessions on every device", async ({ page, browser, baseURL }) => {
  const errors = watchErrors(page, { expect: [{ method: "POST", path: "/api/v1/auth/logout-all", status: 500 }] });
  const email = await register(page);
  const other = await browser.newContext({ baseURL });
  try {
    const login = await other.request.post("/api/v1/auth/login", {
      headers: { "x-steward-csrf": "1", origin: new URL(page.url()).origin },
      data: { email, password: PASSWORD },
    });
    expect(login.ok()).toBe(true);
    const secondPage = await other.newPage();
    await secondPage.goto("/app/account");
    await expect(secondPage.getByRole("heading", { name: "Account and privacy", exact: true })).toBeVisible();

    await page.goto("/app/account");
    const security = page.getByRole("region", { name: "Security", exact: true });
    await expect(security).toContainText("including this one");
    if (process.env.SECURITY_SCREENSHOTS) await page.screenshot({ path: "/home/ubuntu/screens/account-security.png", fullPage: true, caret: "initial" });
    await security.getByRole("button", { name: "Sign out everywhere", exact: true }).click();
    await expect(security).toContainText("All your sessions will end");
    if (process.env.SECURITY_SCREENSHOTS) await page.screenshot({ path: "/home/ubuntu/screens/account-security-confirm.png", fullPage: true, caret: "initial" });
    await security.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(security).not.toContainText("All your sessions will end");

    await page.route("**/api/v1/auth/logout-all", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Unavailable" } }) }));
    await security.getByRole("button", { name: "Sign out everywhere", exact: true }).click();
    await security.getByRole("button", { name: "Sign out everywhere", exact: true }).click();
    await expect(security.getByRole("alert")).toHaveText("Could not sign out everywhere. Please try again.");
    await expect(page).toHaveURL(/\/app\/account$/);
    await page.unroute("**/api/v1/auth/logout-all");
    await security.getByRole("button", { name: "Sign out everywhere", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/app/account");
    await expect(page).toHaveURL(/\/login\?/);
    if (process.env.SECURITY_SCREENSHOTS) await page.screenshot({ path: "/home/ubuntu/screens/account-security-signed-out.png", fullPage: true, caret: "initial" });
    await secondPage.reload();
    await expect(secondPage).toHaveURL(/\/login\?/);
    await networkSettled(page);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});
