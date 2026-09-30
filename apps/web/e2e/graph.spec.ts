import { expect, test, type Page } from "@playwright/test";
import { createCompany, networkSettled, register, watchErrors } from "./session";

/**
 * The knowledge graph, from the founder's side.
 *
 * What this suite exists for cannot be checked anywhere else: that a founder can look at *one* picture of what the
 * company has and tell, line by line, which connections are the company's own columns and which are somebody's
 * sentence. So every step here is about that distinction staying visible — a derived edge printed with the column it
 * was read from, a claim printed with its author, a claim whose row is gone still on the page and droppable, and a
 * claim the vocabulary allows but the server still refuses rendered in the server's own words rather than swallowed.
 *
 * It also walks the whole life of a thing the company knows: recorded (or confirmed because it already knew it),
 * corrected (keeping the spelling it had), merged (keeping every claim and every spelling), and forgotten. That
 * path is where knowledge quietly leaks in a product like this, so it is asserted end to end rather than in pieces.
 */

/** The company's own page for a row, seeded through the API: this suite is about reading columns, not about forms. */
async function seed(page: Page, path: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await page.request.post(`/api/v1${path}`, { headers: { origin: new URL(page.url()).origin }, data });
  expect(response.status(), `${path} → ${response.status()}`).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

async function company(page: Page, name: string): Promise<{ id: string; base: string }> {
  const id = await createCompany(page, name);
  return { id, base: `/app/c/${id}` };
}

/** Record a thing through the form, the way a member of the company would. */
async function recordThing(page: Page, fields: { name: string; type?: string; aliases?: string; attributes?: string; confidence?: string }) {
  await page.getByTestId("graph-record").click();
  await expect(page.getByTestId("graph-form")).toBeVisible();
  if (fields.type) await page.getByTestId("graph-type").selectOption({ label: fields.type });
  await page.getByTestId("graph-name").fill(fields.name);
  if (fields.aliases) await page.getByTestId("graph-aliases").fill(fields.aliases);
  if (fields.attributes) await page.getByTestId("graph-attributes").fill(fields.attributes);
  if (fields.confidence) await page.getByTestId("graph-confidence").fill(fields.confidence);
  await page.getByTestId("graph-submit").click();
}

/** Connect a known thing to a row, through the panel: the pickers are the API's own vocabulary. */
async function connectThing(page: Page, opts: { kind: string; target: string; relation: string; note?: string }) {
  await page.getByTestId("graph-connect").click();
  await expect(page.getByTestId("graph-claim-form")).toBeVisible();
  await page.getByTestId("graph-target-kind").selectOption({ label: opts.kind });
  await page.getByTestId("graph-target").selectOption({ label: opts.target });
  await page.getByTestId("graph-relation").selectOption({ label: opts.relation });
  if (opts.note) await page.getByTestId("graph-note").fill(opts.note);
  await page.getByTestId("graph-claim-submit").click();
}

/** The list entry for a row with exactly this label. By label rather than by text, because "Acme Inc" also reads
 * out of "Acme Incorporated", and a graph suite that confused the two would pass for the wrong reason. */
const nodeLabeled = (page: Page, label: string) => page.locator(`[data-testid="graph-node"][data-label="${label}"]`);

test("reads what the company already has, and says which column every connection came from", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const { base, id } = await company(page, "Graph Rows");
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);

  // A project through the real form, then a task attached to it through the API: the board has no project field,
  // and what this case is about is the graph reading a column that really is there.
  await page.goto(`${base}/projects`);
  await page.getByLabel("Project name").fill("Payments");
  await page.getByLabel("Project objective").fill("Take payments and ship the ledger to every customer.");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  const projects = (await (await page.request.get(`/api/v1/companies/${id}/projects`)).json()) as { projects: Array<{ id: string; name: string }> };
  await seed(page, `/companies/${id}/tasks`, { title: "Ship the ledger", projectId: projects.projects.find((project) => project.name === "Payments")!.id });
  checkpoint("seeding the rows");

  await page.goto(`${base}/graph`);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge graph" })).toBeVisible();
  await expect(page.getByTestId("graph-count").filter({ hasText: "1 project" })).toBeVisible();
  await expect(page.getByTestId("graph-count").filter({ hasText: "1 task" })).toBeVisible();
  // Nothing has been written down yet, and the page says which of the two halves is empty.
  await expect(page.getByTestId("graph-links")).toContainText("Nothing has been connected yet");
  checkpoint("the first load");

  // The derived half: the task belongs to the project because a column says so, and the column travels with it.
  await nodeLabeled(page, "Payments").click();
  const hood = page.getByTestId("graph-neighborhood");
  await expect(hood).toHaveAttribute("data-kind", "project");
  await expect(page.getByTestId("graph-subject")).toHaveText("Payments");
  await expect(page.getByTestId("graph-derived-field")).toHaveText("Read from tasks.project_id");
  await expect(page.getByTestId("graph-neighbour")).toContainText("Ship the ledger belongs to Payments.");
  // And nothing has been asserted about it by anybody, which is not the same as knowing nothing.
  await expect(page.getByText("Nobody has written anything down about this yet.")).toBeVisible();
  checkpoint("reading a derived edge");

  // Search reaches the rows and the things known, wherever they live — the question is "where is this mentioned".
  await page.getByTestId("graph-search").fill("ledger");
  await page.getByTestId("graph-search-submit").click();
  await expect(page.getByTestId("graph-notice")).toContainText("Found 1 match");
  await expect(page.getByTestId("graph-node")).toHaveCount(1);
  await expect(nodeLabeled(page, "Ship the ledger")).toBeVisible();
  await page.getByTestId("graph-search").fill("nothing at all like this");
  await page.getByTestId("graph-search-submit").click();
  await expect(page.getByTestId("graph-notice")).toContainText("Nothing this company has or knows mentions");
  await page.getByRole("button", { name: "Clear" }).click();
  checkpoint("searching");

  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("records a thing, confirms the one it already knew, corrects it, connects it, merges a duplicate and forgets it", async ({ page }) => {
  // Two refusals are this test's point, and both are rendered on the page and asserted below: the graph's own rules
  // turning down a name that says nothing, and the server refusing a claim whose target is a competitor.
  const errors = watchErrors(page, {
    expect: [
      { method: "POST", path: /\/graph\/entities$/, status: 422 },
      { method: "POST", path: /\/graph\/entities\/[^/]+\/links$/, status: 422 },
    ],
  });
  await register(page);
  const { base, id } = await company(page, "Graph Things");
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);
  await seed(page, `/companies/${id}/projects`, { name: "Payments", objective: "Take payments and ship the ledger." });

  await page.goto(`${base}/graph`);
  // The company's own row is here and nothing has been recorded about the world yet, which is not the same thing
  // as the page being empty.
  await expect(nodeLabeled(page, "Payments")).toBeVisible();
  await expect(page.getByTestId("graph-count").filter({ hasText: "known thing" })).toHaveCount(0);
  checkpoint("the first load");

  // A name that says nothing is refused by the graph's own rules, in the graph's own words, against the field.
  await recordThing(page, { name: "x", attributes: `{"domain": "${"x".repeat(401)}"}` });
  const problems = page.getByTestId("graph-problems");
  await expect(problems).toBeVisible();
  await expect(problems).toContainText("name");
  await expect(problems).toContainText("Give it the name a person would say out loud.");
  await expect(problems).toContainText("The value of domain is longer than 400 characters.");
  checkpoint("a refusal from the graph's own rules");

  // Fixing it records it, and what it is also known as is kept rather than folded away.
  await page.getByTestId("graph-name").fill("Acme, Inc.");
  await page.getByTestId("graph-attributes").fill(`{"domain": "acme.test"}`);
  await page.getByTestId("graph-aliases").fill("Acme Incorporated");
  await page.getByTestId("graph-confidence").fill("0.8");
  await page.getByTestId("graph-submit").click();
  await expect(page.getByTestId("graph-notice")).toContainText("Recorded “Acme, Inc.”");
  await expect(page.getByTestId("graph-count").filter({ hasText: "1 known thing" })).toBeVisible();
  checkpoint("recording a thing");

  // The same name, written differently, is the same thing: confirmed, not a second node.
  await recordThing(page, { name: "ACME,  INC." });
  await expect(page.getByTestId("graph-notice")).toContainText("already knew");
  await expect(nodeLabeled(page, "Acme, Inc.")).toHaveCount(1);
  checkpoint("confirming what it already knew");

  // The row behind the node is on the page: every spelling, the fields, and how sure the record is.
  await nodeLabeled(page, "Acme, Inc.").click();
  const known = page.getByTestId("graph-known");
  await expect(known).toContainText("Also known as “Acme Incorporated”");
  await expect(known).toContainText('{"domain":"acme.test"}');
  await expect(page.getByTestId("graph-neighborhood")).toContainText("Fairly sure");
  checkpoint("opening a known thing");

  // A claim is written down with its author, and reads differently from the company's own columns.
  await connectThing(page, { kind: "Project", target: "Payments", relation: "Works on", note: "owns the ledger" });
  await expect(page.getByTestId("graph-notice")).toContainText("Connected.");
  const claim = page.getByTestId("graph-claim");
  await expect(claim).toHaveCount(1);
  await expect(claim).toHaveAttribute("data-relation", "works_on");
  await expect(claim).toHaveAttribute("data-dangling", "false");
  await expect(claim).toContainText("owns the ledger");
  await expect(claim.getByTestId("graph-claim-provenance")).toContainText("Written by the founder");
  // Its sentence is the same one the project sees from the other end.
  await nodeLabeled(page, "Payments").click();
  await expect(page.getByTestId("graph-claim")).toContainText("Acme, Inc. works on Payments.");
  await nodeLabeled(page, "Acme, Inc.").click();
  checkpoint("recording a claim");

  // The vocabulary allows "works at" a company; this one is a competitor, and the server says so rather than storing it.
  await recordThing(page, { name: "Globex", type: "Competitor" });
  await expect(page.getByTestId("graph-notice")).toContainText("Recorded “Globex”");
  await nodeLabeled(page, "Acme, Inc.").click();
  await connectThing(page, { kind: "Known thing", target: "Globex", relation: "Works at" });
  await expect(page.getByTestId("graph-problems")).toContainText("not at a competitor");
  // The form stays open on the refusal, with the claim not made and nothing half-written.
  await expect(page.getByTestId("graph-claim-form")).toBeVisible();
  await expect(page.getByTestId("graph-claim")).toHaveCount(1);
  await page.getByTestId("graph-claim-cancel").click();
  checkpoint("a claim the server refuses on the type of the target");

  // Correcting keeps the spelling it had, so a search for the old name still finds the row.
  await page.getByTestId("graph-correct").click();
  await expect(page.getByTestId("graph-form")).toHaveAttribute("data-editing", "true");
  await page.getByTestId("graph-name").fill("Acme Incorporated");
  await page.getByTestId("graph-submit").click();
  await expect(page.getByTestId("graph-notice")).toContainText("kept as an alias");
  await expect(page.getByTestId("graph-known")).toContainText("Also known as “Acme, Inc.”");
  await page.getByTestId("graph-search").fill("Acme, Inc.");
  await page.getByTestId("graph-search-submit").click();
  await expect(nodeLabeled(page, "Acme Incorporated")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  checkpoint("correcting a thing");

  // A duplicate is folded in: its claims and spellings become the survivor's, and only then does it go.
  await recordThing(page, { name: "Acme Inc" });
  await nodeLabeled(page, "Acme Incorporated").click();
  await expect(page.getByTestId("graph-claim")).toHaveCount(1);
  await page.getByTestId("graph-merge").click();
  await page.getByTestId("graph-merge-input").selectOption({ label: "Acme Inc (Company)" });
  await page.getByTestId("graph-merge-submit").click();
  await expect(page.getByTestId("graph-notice")).toContainText("The spellings it arrived with are kept: “Acme, Inc.”, “Acme Inc”.");
  await expect(nodeLabeled(page, "Acme Inc")).toHaveCount(0);
  await expect(page.getByTestId("graph-known")).toContainText("“Acme Inc”");
  await expect(page.getByTestId("graph-claim")).toHaveCount(1);
  checkpoint("merging a duplicate");

  // Forgetting takes the thing and everything said about it, and nothing else.
  await page.getByTestId("graph-forget").click();
  await page.getByTestId("graph-forget-confirm").click();
  await expect(page.getByTestId("graph-notice")).toContainText("The rows those claims pointed at are untouched");
  await expect(nodeLabeled(page, "Acme Incorporated")).toHaveCount(0);
  await nodeLabeled(page, "Payments").click();
  await expect(page.getByText("Nobody has written anything down about this yet.")).toBeVisible();
  await expect(page.getByTestId("graph-links")).toContainText("Nothing has been connected yet");
  checkpoint("forgetting a thing");

  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("keeps a claim whose row is gone on the page, and lets somebody drop it", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const { base, id } = await company(page, "Graph Claims");
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);

  const memory = (await seed(page, `/companies/${id}/memories`, { kind: "knowledge", content: "The pilot pricing ends in March." })) as { memory: { id: string } };
  await page.goto(`${base}/graph`);
  await recordThing(page, { name: "Globex", type: "Competitor" });
  await nodeLabeled(page, "Globex").click();
  await connectThing(page, { kind: "Memory", target: "The pilot pricing ends in March.", relation: "Recorded in" });
  await expect(page.getByTestId("graph-claim")).toHaveAttribute("data-dangling", "false");
  checkpoint("a claim that still resolves");

  // The row goes, from the memory's own page — and the claim stays, saying what happened rather than disappearing.
  const removed = await page.request.delete(`/api/v1/companies/${id}/memories/${memory.memory.id}`, { headers: { origin: new URL(page.url()).origin } });
  expect(removed.status()).toBe(200);
  await nodeLabeled(page, "Globex").click();
  const claim = page.getByTestId("graph-claim");
  await expect(claim).toHaveAttribute("data-dangling", "true");
  await expect(claim.getByTestId("graph-claim-provenance")).toContainText("the row it names is gone");
  await expect(claim).toContainText("Whatever it was about is no longer here. The claim stays until somebody drops it.");
  await expect(page.getByTestId("graph-links")).toContainText("1 of them pointing at something this company no longer has");
  checkpoint("a claim whose row is gone");

  await claim.getByTestId("graph-drop").click();
  await expect(page.getByTestId("graph-notice")).toContainText("The row it pointed at is untouched.");
  await expect(page.getByTestId("graph-claim")).toHaveCount(0);
  await expect(page.getByTestId("graph-links")).toContainText("Nothing has been connected yet");
  checkpoint("dropping the claim");

  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("opens on a phone without scrolling sideways", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const { base, id } = await company(page, "Graph Phone");
  const project = (await seed(page, `/companies/${id}/projects`, { name: "Payments", objective: "Take payments and ship the ledger." })) as { project: { id: string } };
  await seed(page, `/companies/${id}/tasks`, { title: "Ship the ledger", projectId: project.project.id });

  await page.goto(`${base}/graph`);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge graph" })).toBeVisible();
  await recordThing(page, { name: "Acme, Inc.", attributes: `{"domain": "acme.test"}`, confidence: "0.8" });
  await expect(page.getByTestId("graph-notice")).toContainText("Recorded");
  await nodeLabeled(page, "Acme, Inc.").click();
  await expect(page.getByTestId("graph-subject")).toBeVisible();

  // The claim form is the widest thing this page can draw: three selectors, a note, and a long sentence under one.
  await connectThing(page, { kind: "Project", target: "Payments", relation: "Works on", note: "owns the ledger" });
  await expect(page.getByTestId("graph-claim")).toHaveCount(1);
  // And the other half of the picture, which is the widest drawing of all: what the rows themselves say.
  await nodeLabeled(page, "Payments").click();
  await expect(page.getByTestId("graph-derived")).toBeVisible();
  await expect(page.getByTestId("graph-claim")).toHaveCount(1);

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
  // and the Linux machine CI runs on. Only `main` is measured, because this bump widens the shell's own furniture
  // with it and the shell is not what this is about.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "19px";
  });
  const withWiderText = await pastTheEdge();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  expect(withWiderText, `with wider text these reach past the phone: ${withWiderText.join(" | ")}`).toEqual([]);

  // A page that fits is only worth having if it also ran: every width above was measured on a live page.
  await networkSettled(page);
  expect(errors).toEqual([]);
});
