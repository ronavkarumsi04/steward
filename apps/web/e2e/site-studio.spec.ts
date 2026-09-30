import { expect, test } from "@playwright/test";
import { createCompany, networkSettled, register, watchErrors } from "./session";

/**
 * The Site Studio, driven the way a founder drives it: start from the company's own words, change a headline,
 * watch the preview agree, finish what publishing needs, publish a version, then put that version back.
 *
 * These assertions are about the seams rather than the widgets. A headline typed into the editor has to appear in
 * the preview — because the preview is rendered by the server from the saved draft, not from a second rendering
 * path in the browser. Publishing has to be refused while the checklist is not empty, and the same checklist has
 * to clear. A version has to be restored as the draft, and a reload has to still show it: the site is rows in a
 * database, not a page's memory.
 */
test.describe.configure({ mode: "serial" });

/**
 * The preview is rendered in an iframe with no permissions at all, and the dev server's overlay still tries to
 * insert its own script into every document it can see: the browser refuses it and says so. That message is the
 * sandbox doing its job, not a fault in the page — and the bundle itself carries no script to run either way. Both
 * tests drop it from what they saw; everything else the page said has to be nothing.
 */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/;

test("build a page, see it, publish it, and put a version back", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const companyId = await createCompany(page, "Site Studio E2E");

  // The company's own sidebar reaches it, which is how a founder would find it a second time.
  await page.getByRole("link", { name: "Website" }).click();
  await page.waitForURL(new RegExp(`/app/c/${companyId}/site$`));

  // A company with no site is offered the starting draft built from its own profile — nothing written yet.
  await expect(page.getByText(/has no website yet/i)).toBeVisible();
  await page.getByRole("button", { name: "Start from this draft" }).click();

  // It saves as a draft and the checklist says what publishing still needs. Saving worked; publishing cannot yet.
  const checklist = page.getByRole("heading", { name: "Before this can be published" }).locator("..");
  await expect(checklist.getByText(/paragraph 1 is empty/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish a version" })).toBeDisabled();

  // Edit the hero. The field exists because the server's catalog says a hero has a headline — not because this
  // screen knows what a hero is.
  const hero = page.locator("[data-block=hero]");
  await hero.getByLabel("Headline").fill("Revenue, explained every Monday");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();

  // The preview is the saved draft, rendered by the server: the words typed above are in the HTML.
  const frame = page.frameLocator('iframe[title^="Preview of"]');
  await expect(frame.locator("h1")).toContainText("Revenue, explained every Monday");

  // Finish what publishing requires: a paragraph with words in it, and a way to reach a person — which lives on
  // the contact page, so the checklist is the document's, not the page's.
  await page.locator("[data-block=text]").getByLabel("Paragraph 1").fill("Steward reads your sales, and writes the summary you would have written.");
  await page.locator('[data-page="contact"]').click();
  // A page that does not open with a hero still has exactly one h1: the page's own title, rendered by the server.
  await expect(frame.locator("h1")).toHaveCount(1);
  await expect(frame.locator("h1")).toContainText("Contact");
  await page.locator("[data-block=contact]").getByLabel("Email").fill("hello@example.com");
  await page.locator('[data-page="index"]').click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(checklist.getByText(/nothing is missing/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish a version" })).toBeEnabled();

  // Publish: a version with a digest, and nothing claimed about the internet.
  await page.getByRole("button", { name: "Publish a version" }).click();
  await expect(page.getByText(/Version 1 is built and stored/)).toBeVisible();
  await expect(page.getByText(/nothing is on the internet yet/i)).toBeVisible();
  const versions = page.getByRole("heading", { name: "Versions" }).locator("..");
  await expect(versions.getByText("v1")).toBeVisible();
  await expect(versions.getByRole("link", { name: "Download" })).toBeVisible();

  // A stored version renders the same bytes the draft did.
  await versions.getByRole("button", { name: "Look at it" }).click();
  await expect(frame.locator("h1")).toContainText("Revenue, explained every Monday");

  // Change the draft, publish a second version, then put the first one back.
  await hero.getByLabel("Headline").fill("A different headline");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.getByRole("button", { name: "Publish a version" }).click();
  await expect(page.getByText(/Version 2 is built and stored/)).toBeVisible();
  await expect(versions.getByText("v2")).toBeVisible();

  await versions.getByRole("button", { name: "Restore" }).last().click();
  await expect(page.getByText(/Version 1 is the draft again/)).toBeVisible();
  await expect(hero.getByLabel("Headline")).toHaveValue("Revenue, explained every Monday");

  // A reload proves the draft is durable and that the studio reopens on it rather than on the starting point.
  await page.reload();
  await expect(page.locator("[data-block=hero]").getByLabel("Headline")).toHaveValue("Revenue, explained every Monday");
  await expect(page.getByRole("button", { name: "Start from this draft" })).toHaveCount(0);

  // Shipping is a separate decision, and the studio says what it would tell the agent before it starts one.
  await versions.getByRole("button", { name: "Ship it" }).first().click();
  await expect(page.getByText(/The agent is told to write these exact bytes/i)).toBeVisible();

  await networkSettled(page);
  expect(errors.filter((message) => !SANDBOX_NOTICE.test(message))).toEqual([]);
});

/**
 * The editor has to fit the phone a founder actually checks their site on. A page that scrolls sideways is the
 * most common way a two-column editor breaks at 390 px, and the failure is invisible on a laptop.
 */
test("fits a phone, and the preview is the only thing that scrolls", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const companyId = await createCompany(page, "Site Studio Phone");
  await page.goto(`/app/c/${companyId}/site`);
  await page.getByRole("button", { name: "Start from this draft" }).click();
  await expect(page.getByRole("heading", { name: "Before this can be published" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Save draft" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Publish a version" })).toBeInViewport();
  await expect(page.locator("[data-block=hero]").getByLabel("Headline")).toBeVisible();

  // A page that fits is only worth having if it also ran: the widths above were measured on a live page, preview
  // document and all.
  await networkSettled(page);
  expect(errors.filter((message) => !SANDBOX_NOTICE.test(message))).toEqual([]);
});
