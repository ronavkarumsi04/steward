import { expect, test } from "@playwright/test";
import { createCompany, register, watchErrors } from "./session";

/**
 * The workflow builder, from the founder's side.
 *
 * The thing this test exists for cannot be checked anywhere else: that **the drawing is the work**. A builder can
 * look right while publishing nothing, or publish something subtly different from what is on the canvas, and no
 * unit test can see that — so this one draws a workflow through the real page, publishes it, and then walks to the
 * reactions surface to read the rule that appeared there. If the two surfaces ever disagree, this fails.
 *
 * It also checks the two states a builder is most likely to blur: a drawing that has been saved is not running,
 * and pausing a drawing pauses the row it published.
 */
test("draws a workflow, publishes it, and the rule it publishes is a real rule", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const companyId = await createCompany(page, "Workflow Studio");

  await page.goto(`/app/c/${companyId}/workflows`);
  await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
  await expect(page.getByText(/No workflows yet/)).toBeVisible();

  // A new drawing starts on a shape rather than on an empty canvas. It is storable while it is unfinished — the
  // page says so in those words rather than refusing to hold it — and nothing is running until it is published.
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page.getByTestId("workflow-canvas")).toBeVisible();
  await expect(page.getByTestId("workflow-list")).toContainText("Not finished yet");
  await expect(page.getByTestId("workflow-unfinished")).toContainText("Write what the agent should do");
  await expect(page.getByTestId("workflow-readings")).toContainText("has not been published");

  await page.getByLabel("Workflow name").fill("Payment watch");
  await page.getByTestId("trigger-kinds").getByRole("checkbox", { name: "payment.failed" }).check();
  await page.getByLabel("Instruction").fill("Read the failed payment and write down what to do next.");
  await page.getByTestId("add-limit").click();
  await page.getByLabel("Runs per hour").fill("3");

  // Writing the instruction makes it whole, and the page stops saying it is unfinished.
  await expect(page.getByTestId("workflow-unfinished")).toHaveCount(0);

  // The preview is the server compiling the drawing, so it says what would run before anything does.
  await expect(page.getByTestId("workflow-sentences")).toContainText("payment.failed");
  await expect(page.getByTestId("workflow-sentences")).toContainText("Read the failed payment and write down what to do next.");
  await expect(page.getByTestId("workflow-sentences")).toContainText("at most 3 runs an hour");

  await page.getByTestId("workflow-publish").click();
  await expect(page.getByTestId("workflow-list")).toContainText("Live");
  await expect(page.getByTestId("workflow-readings")).toContainText("Running as “Payment watch”");

  // The drawing is the work: the reactions surface shows the rule, with the fields the drawing set.
  await page.goto(`/app/c/${companyId}/signals`);
  const rule = page.locator("[data-reaction-rule]").filter({ hasText: "Payment watch" });
  await expect(rule).toBeVisible();
  await expect(rule).toContainText("payment.completed, payment.failed");
  await expect(rule).toContainText("up to 3/hour");

  // A drawing that is paused takes its row with it, and says so on both surfaces.
  await page.goto(`/app/c/${companyId}/workflows`);
  await page.getByTestId("workflow-toggle").click();
  await expect(page.getByTestId("workflow-list")).toContainText("Paused");
  await expect(page.getByTestId("workflow-readings")).toContainText("paused");
  await page.goto(`/app/c/${companyId}/signals`);
  await expect(page.locator("[data-reaction-rule]").filter({ hasText: "Payment watch" })).toContainText("paused");

  expect(errors).toEqual([]);
});

test("opens on a phone without scrolling sideways", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const companyId = await createCompany(page, "Workflow Phone");

  await page.goto(`/app/c/${companyId}/workflows`);
  await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page.getByTestId("workflow-canvas")).toBeVisible();
  await expect(page.getByLabel("Instruction")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // A page that fits is only worth having if it also ran: the width was measured on a live page.
  expect(errors).toEqual([]);
});
