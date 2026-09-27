import { expect, test } from "@playwright/test";
import { PASSWORD, openCompanyPalette, register } from "./session";

const password = PASSWORD;

test.describe.configure({ mode: "serial" });

test("landing links to sign-in, register and API docs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /get started|register|create/i }).first()).toBeVisible();
});

test("unauthenticated workspace redirects to login; bad credentials show an error", async ({ page }) => {
  await page.goto("/app");
  await page.waitForURL(/\/login/);
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("register → onboarding → dashboard → tasks → settings → providers → sign out → sign in", async ({ page }) => {
  const email = await register(page);

  // A fresh account has no companies, so /app forwards to onboarding.
  await page.waitForURL(/\/app\/new$/);
  await page.getByLabel("Company name").fill("E2E Analytics");
  await page.getByLabel("The idea, in your own words").fill("A weekly analytics digest for small online stores.");
  await page.getByLabel("Target customers (comma-separated)").fill("Shopify store owners, DTC marketers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL(/\/app\/c\/[0-9a-f-]+$/);
  const companyUrl = page.url();

  // Dashboard renders durable state seeded by company creation, including the onboarding profile.
  await expect(page.getByRole("heading", { name: "E2E Analytics", exact: true })).toBeVisible();
  await expect(page.getByText("A weekly analytics digest for small online stores.")).toBeVisible();
  await expect(page.getByText(/autonomy/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Earn" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Turn on Autopilot/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work Steward delegated" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What exists outside Steward" })).toBeVisible();
  await expect(page.getByText("Not live yet")).toBeVisible();

  // Company command palette and keyboard navigation are available throughout the operating shell.
  await openCompanyPalette(page);
  const palette = page.getByLabel("Search or type a command");
  await expect(palette).toBeFocused();
  // A company with nothing waiting is told so, rather than shown a blank line that reads like a failed load.
  await expect(page.getByText(/nothing awaiting a decision/)).toBeVisible();
  // Typing narrows to the thing itself: a page name reaches its page from the keyboard.
  await palette.fill("settings");
  await expect(page.getByRole("option").first()).toContainText("Settings");
  await palette.fill("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Company command palette" })).toBeHidden();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await page.waitForURL(/\/activity$/);
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await page.waitForURL(/\/tasks$/);

  // Projects: founder outcomes persist independently of model/provider availability.
  await page.goto(`${companyUrl}/projects`);
  await expect(page.getByRole("heading", { name: "Outcomes that survive every thread" })).toBeVisible();
  await page.getByLabel("Project name").fill("E2E launch project");
  await page.getByLabel("Project objective").fill("Launch a durable pilot across multiple specialist work sessions");
  await page.getByLabel("Project success signal").fill("A real design partner completes the pilot");
  await page.getByLabel("Project next step").fill("Prepare the first onboarding workflow");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "E2E launch project" })).toBeVisible();
  await expect(page.getByText("Launch a durable pilot across multiple specialist work sessions")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "E2E launch project" })).toBeVisible();

  // Tasks: create one without starting a run (no model provider is configured in E2E).
  await page.goto(`${companyUrl}/tasks`);
  await page.getByLabel("Task title").fill("Draft positioning statement");
  await page.getByLabel(/start now/i).uncheck();
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Draft positioning statement")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Draft positioning statement")).toBeVisible();

  // The palette is a work surface, not a menu. The task that was just created is reachable as work to start or
  // hand over, and nothing runs until the founder reads what it would do and confirms it.
  await openCompanyPalette(page);
  await page.getByLabel("Search or type a command").fill("positioning statement");
  await expect(page.getByRole("option", { name: /Run “Draft positioning statement”/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /(Assign|Reassign) “Draft positioning statement”/ })).toBeVisible();
  await page.keyboard.press("Enter");
  // Choosing to run asks which agent first, and lists only agents that could actually do it.
  await expect(page.getByLabel("Choose the agent")).toBeFocused();
  await expect(page.getByRole("option", { name: /Run “Draft positioning statement” with / }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  // Then it states the consequences — the same reasons the decision surface gives — before anything starts.
  await expect(page.getByRole("group", { name: /Start a run for “Draft positioning statement”/ })).toBeVisible();
  await expect(page.getByText(/stops for approval wherever your policies require it/)).toBeVisible();
  // Escape backs out one step at a time, and the run was never started.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Choose the agent")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Search or type a command")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Company command palette" })).toBeHidden();

  // Runs: whichever deployment this is, the run surface has to stay honest. With Temporal connected (CI
  // starts one) the run is created and the inspector must describe it; on a checkout without Temporal the
  // API refuses to start a run at all, and the list must stay empty rather than show invented work.
  const companyId = companyUrl.split("/").pop()!;
  const agentList = (await (await page.request.get(`/api/v1/companies/${companyId}/agents`)).json()) as { agents: Array<{ id: string }> };
  const runResponse = await page.request.post(`/api/v1/companies/${companyId}/runs`, {
    // Cookie-authenticated mutations are CSRF-gated on the Origin the browser itself would send.
    headers: { origin: new URL(page.url()).origin },
    data: { agentId: agentList.agents[0].id, instruction: "Draft the design partner email" },
  });
  const runBody = (await runResponse.json().catch(() => null)) as { message?: string } | null;
  const runRecorded = runResponse.status() === 201 || /recorded as/i.test(runBody?.message ?? "");
  if (runRecorded) {
    await page.goto(`${companyUrl}/runs`);
    await page.getByRole("link", { name: "Draft the design partner email" }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]+$/);
    await expect(page.getByRole("region", { name: "Run inspection" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Timeline/ })).toBeVisible();
    // No model provider is configured here, so this run cannot be a verified success whatever path it took.
    await expect(page.getByText("Succeeded, verified")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Run inspection" })).toBeVisible();
  } else {
    expect(runResponse.status()).toBe(503);
    await page.goto(`${companyUrl}/runs`);
    await expect(page.getByText("No runs match.")).toBeVisible();
  }

  // Growth: a lead is durable and visible in the customer pipeline.
  await page.goto(`${companyUrl}/growth`);
  await page.getByLabel("Lead title").fill("Pilot design partner");
  await page.getByLabel("Lead email").fill(`pilot-${Date.now()}@example.com`);
  await page.getByLabel("Lead company").fill("E2E Retailer");
  await page.getByLabel("Lead value USD").fill("1200");
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page.getByText("Pilot design partner")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pilot design partner")).toBeVisible();

  // Campaigns persist as plans; creation itself does not send anything.
  await page.getByLabel("Campaign name").fill("Design partner launch");
  await page.getByLabel("Campaign channel").selectOption("email");
  await page.getByLabel("Campaign audience").fill("Independent retailers");
  await page.getByLabel("Campaign objective").fill("Book five customer interviews");
  await page.getByLabel("Campaign budget USD").fill("250");
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByText("Design partner launch")).toBeVisible();
  await expect(page.getByText("Book five customer interviews")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Design partner launch")).toBeVisible();

  // Agents seeded by company creation.
  await page.goto(`${companyUrl}/agents`);
  await expect(page.getByText(/orchestrator|chief of staff/i).first()).toBeVisible();

  // Approvals: a decision surface that answers why, what will execute and what it touches. A fresh company
  // usually has nothing waiting (a run needs a model provider to reach a policy gate), so the branch that
  // matters here is that the page states which of the two situations it is in rather than rendering a shell.
  await page.goto(`${companyUrl}/approvals`);
  await expect(page.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Filter approvals" })).toBeVisible();
  const waiting = page.locator("article[data-approval-status='pending']");
  if (await waiting.count()) {
    const first = waiting.first();
    await expect(first.getByRole("heading", { name: /why you were asked/i })).toBeVisible();
    await expect(first.getByRole("heading", { name: /what will execute/i })).toBeVisible();
    await expect(first.getByRole("heading", { name: /blast radius/i })).toBeVisible();
    await expect(first.getByText("System that changes")).toBeVisible();
    await expect(first.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    await expect(first.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
  } else {
    await expect(page.getByText(/No pending approvals\./)).toBeVisible();
  }

  // Integrations are discoverable from the authenticated company workspace.
  await page.getByRole("link", { name: "Integrations" }).first().click();
  await page.waitForURL(/\/integrations/);
  await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();

  // Settings: pause outbound actions and confirm the state persists across reload.
  await page.goto(`${companyUrl}/settings`);
  await page.getByRole("button", { name: "Pause all outbound actions" }).click();
  await expect(page.getByRole("button", { name: "Resume outbound actions" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume outbound actions" })).toBeVisible();

  // Org providers page: companion pairing yields a one-time code, never a key.
  await page.getByRole("link", { name: "Providers" }).first().click();
  await page.waitForURL(/\/providers$/);
  await expect(page.getByText("Local Companions")).toBeVisible();
  await page.getByPlaceholder("Ronav's MacBook").fill("E2E laptop");
  await page.getByRole("button", { name: "Pair a new companion" }).click();
  await expect(page.getByText(/steward-companion pair --server .* --code \d{6}/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("scd_");

  // Sign out invalidates the session; signing back in restores access.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/(login)?$/);
  await page.goto(companyUrl);
  await page.waitForURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/c\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2E Analytics", exact: true })).toBeVisible();
});