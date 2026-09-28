import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createCompany, register, watchErrors } from "./session";

/**
 * The marketplace, from the founder's side.
 *
 * What this test exists for cannot be checked anywhere else: that a company can bring in somebody else's server
 * and *see what it may do* on the page, in a real browser. The inspection it drives is a real MCP handshake — the
 * API spawns `packages/tools/fixtures/mcp-server.mjs` over stdio, the same fixture the seam's own tests use — so
 * the tool list, the risk bands and the "where did that band come from" sentences on the page are the product's
 * answer about a server that really answered.
 *
 * The other half is the honest failures, which are the states a marketplace is most likely to hide: an install
 * this deployment will not carry out, and a server that could not be reached. Neither may read as "installed and
 * ready", so both are asserted in the API's own words.
 */

/** The fixture server, spawned by the API exactly as a company's own install would be. */
const FIXTURE = fileURLToPath(new URL("../../../packages/tools/fixtures/mcp-server.mjs", import.meta.url));

/** The install form, filled in for a stdio server. */
async function installStdio(page: import("@playwright/test").Page, opts: { name: string; slug: string; command: string; args: string }) {
  await page.getByTestId("mcp-new").click();
  await expect(page.getByTestId("mcp-form")).toBeVisible();
  await page.getByTestId("mcp-name").fill(opts.name);
  await page.getByTestId("mcp-slug").fill(opts.slug);
  await page.getByTestId("mcp-purpose").fill("Customers and invoices.");
  await page.getByTestId("mcp-command").fill(opts.command);
  await page.getByTestId("mcp-args").fill(opts.args);
  await page.getByTestId("mcp-submit").click();
}

test("installs a server, sees what it may do, and decides who may call it", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const companyId = await createCompany(page, "Marketplace");
  await page.goto(`/app/c/${companyId}/mcp`);
  await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();

  // The first screen is honest about the deployment it is on and about there being nothing installed yet.
  await expect(page.getByText("No server is installed.")).toBeVisible();
  await expect(page.getByText("This deployment runs programs for stdio servers")).toBeVisible();
  await expect(page.getByText("Its own network is refused")).toBeVisible();

  // A slug another install would collide with is refused by the API, in the API's words, against the field.
  await installStdio(page, { name: "Ledger", slug: "Ledger API!", command: process.execPath, args: FIXTURE });
  await expect(page.getByTestId("mcp-problems")).toBeVisible();
  await expect(page.getByTestId("mcp-problems")).toContainText("slug");
  await expect(page.getByTestId("mcp-problems")).toContainText("lowercase");
  await expect(page.getByTestId("mcp-server")).toHaveCount(0);

  // Fixing it installs the server — and installing it offers nothing, because nothing has been asked yet.
  await page.getByTestId("mcp-slug").fill("ledger");
  await page.getByTestId("mcp-submit").click();
  const card = page.getByTestId("mcp-server");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("mcp-standing")).toContainText("Installed, not inspected");
  await expect(card).toContainText("Nothing is known about this server yet");

  // Inspecting is the only act that connects. It is a real handshake with a real server.
  await card.getByTestId("mcp-inspect").click();
  await expect(card.getByTestId("mcp-standing")).toContainText("Inspected");
  const tools = card.getByTestId("mcp-tool");
  await expect(tools).toHaveCount(6);

  // What it may do, worst first, with the tool's other name and where its band came from.
  await expect(tools.first()).toContainText("delete_customer");
  const invoice = card.getByTestId("mcp-tool").filter({ hasText: "lookup_invoice" });
  await expect(invoice.getByTestId("mcp-risk")).toHaveText("Low");
  await expect(invoice).toContainText("Reads only");
  await expect(invoice).toContainText("The server says this tool only reads.");
  await expect(invoice).toContainText("the server's own claim");
  await expect(invoice).toContainText("mcp.ledger.lookup_invoice");
  // The one a naive classifier gets wrong: a name that reads as a query, an annotation that says it writes.
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "get_and_reissue" }).getByTestId("mcp-risk")).toHaveText("High");
  // And the one the server said nothing about says exactly that.
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "reschedule" })).toContainText("nothing the server said");

  // Nothing is granted by installing, and the grant is the agent's own allowlist written by the API.
  await expect(card.getByTestId("mcp-grant-summary")).toContainText("no agent may call any of it");
  await card.getByTestId("mcp-grant-all").click();
  await expect(card.getByTestId("mcp-grant-summary")).toContainText("Granted to");
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "lookup_invoice" })).toContainText("Granted to");

  // Taking one tool back out of a whole-server grant leaves the others named explicitly rather than dropping them.
  await card.getByTestId("mcp-tool").filter({ hasText: "delete_customer" }).getByTestId("mcp-tool-grant").click();
  const narrowed = card.getByTestId("mcp-tool").filter({ hasText: "delete_customer" });
  await expect(narrowed).not.toContainText("Granted to");
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "lookup_invoice" })).toContainText("Granted to");

  // Blocking a tool is a per-tool decision that survives the grant; pausing the install takes all of it away.
  await narrowed.getByTestId("mcp-tool-block").click();
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "delete_customer" })).toContainText("Blocked");
  await card.getByTestId("mcp-toggle").click();
  await expect(card.getByTestId("mcp-standing")).toContainText("Paused");
  await expect(card.getByText("no agent can call any of its tools")).toBeVisible();

  // Reloading draws that same card on the server and hydrates it in the browser — the only way a founder meets a
  // server that was already installed, and the state where a mismatch between the two renderings would hide.
  await page.reload();
  await expect(card.getByTestId("mcp-standing")).toContainText("Paused");
  await expect(card.getByTestId("mcp-tool")).toHaveCount(6);
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "delete_customer" })).toContainText("Blocked");
  await expect(card.getByTestId("mcp-tool").filter({ hasText: "lookup_invoice" })).toContainText("Granted to");

  // Removing it takes the record with it, and says what that means for the grants already written.
  await card.getByTestId("mcp-remove").click();
  await card.getByTestId("mcp-remove-confirm").click();
  await expect(page.getByText("No server is installed.")).toBeVisible();
  await expect(page.getByTestId("mcp-server")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("says a server is out of reach instead of showing an empty list as if it were a fact", async ({ page }) => {
  const errors = watchErrors(page);
  /**
   * The browser's own error list is checked at every step, because *when* an error arrived is the diagnosis: a
   * hydration mismatch is thrown while the page is still loading, a failed request only once a button is pressed.
   * Asserting once at the end would say only that something went wrong somewhere on the page.
   */
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);
  await register(page);
  const companyId = await createCompany(page, "Marketplace Offline");
  checkpoint("the end of onboarding");
  await page.goto(`/app/c/${companyId}/mcp`);
  await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
  await expect(page.getByText("No server is installed.")).toBeVisible();
  checkpoint("the first load — nothing is installed yet");

  await installStdio(page, { name: "Gone", slug: "gone", command: "steward-mcp-that-does-not-exist", args: "" });
  checkpoint("installing");
  const card = page.getByTestId("mcp-server");
  await card.getByTestId("mcp-inspect").click();
  await expect(card.getByTestId("mcp-error")).toBeVisible();
  checkpoint("a failed inspection");

  // Reachability is the server's condition and not a failed request: the page stays whole and says what happened.
  await expect(card.getByTestId("mcp-standing")).toContainText("Could not be reached");
  await expect(card.getByTestId("mcp-error")).toContainText("Could not start “Gone”");
  await expect(card).toContainText("steward-mcp-that-does-not-exist");
  await expect(card).toContainText("offers nothing — a server nobody has read is not a server an agent may call");
  await expect(card.getByTestId("mcp-tool")).toHaveCount(0);

  // Editing where it points is a different act from renaming it, and the page says the list had to go.
  await card.getByTestId("mcp-edit").click();
  await page.getByTestId("mcp-command").fill(process.execPath);
  await page.getByTestId("mcp-args").fill(FIXTURE);
  await page.getByTestId("mcp-submit").click();
  await expect(page.getByText("discarded because where it points changed")).toBeVisible();
  checkpoint("editing where a server points");
  await card.getByTestId("mcp-inspect").click();
  await expect(card.getByTestId("mcp-standing")).toContainText("Inspected");
  await expect(card.getByTestId("mcp-tool")).toHaveCount(6);
  checkpoint("a second inspection, of the address it now points at");
});

test("opens on a phone without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const companyId = await createCompany(page, "Marketplace Phone");
  await page.goto(`/app/c/${companyId}/mcp`);

  await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
  await page.getByTestId("mcp-new").click();
  await expect(page.getByTestId("mcp-command")).toBeVisible();
  await installStdio(page, { name: "Ledger", slug: "ledger", command: process.execPath, args: FIXTURE });
  const card = page.getByTestId("mcp-server");
  await card.getByTestId("mcp-inspect").click();
  await expect(card.getByTestId("mcp-tool")).toHaveCount(6);
  await expect(card.getByTestId("mcp-tools")).toBeVisible();

  /** Which of the page's own elements reach past the phone, named, so a failure says what the culprit was. */
  const pastTheEdge = () =>
    page.evaluate(() => {
      const width = window.innerWidth;
      return [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > width + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} “${(el.textContent ?? "").trim().slice(0, 40)}”`);
    });

  const past = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(past, `${past}px past the phone; widest in the page: ${(await pastTheEdge()).join(" | ") || "(nothing)"}`).toBeLessThanOrEqual(1);

  // And the page's own content again with every font a little wider, which is the real difference between a laptop
  // and the Linux machine CI runs on — a badge here fitted locally and pushed CI's page 66px past the screen, and
  // nothing else was going to notice. Only `main` is measured, because this bump widens the shell's own furniture
  // with it and the shell is not what this is about.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "19px";
  });
  const withWiderText = await pastTheEdge();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  expect(withWiderText, `with wider text these reach past the phone: ${withWiderText.join(" | ")}`).toEqual([]);
});
