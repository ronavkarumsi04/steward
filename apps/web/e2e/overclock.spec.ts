import { expect, test } from "@playwright/test";
import {
  createCompany,
  register,
  networkSettled,
  watchErrors,
} from "./session";

test("Overclock persists across reloads; real agent tuning and skills validate, save and disable", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await register(page);
  const id = await createCompany(page, "Overclock browser workspace");
  const base = `/app/c/${id}`;
  await page.goto(`${base}/agents`);
  await expect(
    page.getByRole("heading", { name: /runtime tuning/ }),
  ).toHaveCount(0);
  await page.goto(`${base}/settings`);
  const toggle = page.getByRole("switch", { name: "Overclock Mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("link", { name: "Configure agents" }).click();
  await page
    .locator('[data-agent-kind="engineering"]')
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("planning sampling method").selectOption("top_p");
  await page.getByLabel("planning top P").fill("0.72");
  await page.getByLabel("planning output token limit").fill("1024");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.getByLabel("Skill 1 name").fill("Evidence discipline");
  await page.getByLabel("Skill 1 ID").fill("evidence");
  await page
    .getByLabel("Skill 1 instructions")
    .fill("Cite the original source before recommending publication.");
  await page.getByRole("button", { name: "Validate & preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Skill instruction preview" }),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: "## Skill: Evidence discipline" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save Overclock configuration" })
    .click();
  await expect(page.getByRole("status")).toContainText("Configuration saved");
  await page.reload();
  await page
    .locator('[data-agent-kind="engineering"]')
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByLabel("planning top P")).toHaveValue("0.72");
  await expect(page.getByLabel("Skill 1 instructions")).toHaveValue(
    "Cite the original source before recommending publication.",
  );
  await page.goto(`${base}/settings`);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.goto(`${base}/agents`);
  await page
    .locator('[data-agent-kind="engineering"]')
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByLabel("planning sampling method")).toHaveCount(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("unknown-account login gives private guidance and password reset never claims delivery", async ({
  page,
}) => {
  const errors = watchErrors(page, {
    expect: [
      { method: "POST", path: "/api/v1/auth/login", status: 401 },
      { method: "POST", path: "/api/v1/auth/password/forgot", status: 503 },
    ],
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(`missing-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("a-not-real-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "We couldn’t sign you in" }),
  ).toContainText("use your invitation link");
  await expect(
    page.getByRole("link", { name: "Register", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(
    page.getByRole("heading", { name: "Reset your password", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(`missing-${Date.now()}@example.com`);
  const resetResponse = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/v1/auth/password/forgot") &&
      res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Request reset link" }).click();
  expect((await resetResponse).status()).toBe(503);
  // The production boot stack has no delivery provider, and must fail honestly.
  await expect(
    page.getByRole("alert").filter({ hasText: "Password-reset email" }),
  ).toContainText("No email was sent");
  await expect(page.getByText(/^Sent to /)).toHaveCount(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
});
