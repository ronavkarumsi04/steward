import { expect, test, type Page } from "@playwright/test";
import { createCompany, register, watchErrors } from "./session";

/**
 * Memory 2.0, from the founder's side (ADR-0022).
 *
 * A memory is read into every agent's context, so this tab is where a company decides what is worth carrying
 * forward and where it changes its mind without losing the record of what it believed. What this suite exists for
 * cannot be checked anywhere else: that the five verbs — confirm, correct, supersede, merge, forget — mean on the
 * page what they mean in the store. A correction keeps the words it replaced, a superseded fact leaves the list
 * but stays readable, a merge folds one memory into another without doubling it, and only forgetting removes a
 * row. Every step is asserted against the server's own read afterwards, because `router.refresh()` re-renders from
 * the server and a refresh that raced the write would look like a product that quietly did nothing.
 *
 * The confirmation queue is a run's automatic memory — a failed run, an unverified ending or a run with follow-ups,
 * kept for three weeks unless a person confirms it. Automatic memories are written by the runtime, and this
 * deployment has no model provider, so the queue's own path is covered by the API suite (an `auto` row is not
 * creatable through a request); here the empty case is asserted, in the open, rather than skipped silently.
 */

/** A fresh company through the real onboarding, and the base path its pages live under. */
async function company(page: Page, name: string): Promise<{ id: string; base: string }> {
  const id = await createCompany(page, name);
  return { id, base: `/app/c/${id}` };
}

/** Open the company's Memory tab the way a founder does: the Knowledge page, then the tab. */
async function openMemory(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/knowledge`);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await showMemoryTab(page);
}

/** Select the Memory tab on the already-open Knowledge page, without navigating. A reload resets it to Playbooks. */
async function showMemoryTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Memory/ }).click();
  await expect(page.getByRole("heading", { name: "Long-term memory" })).toBeVisible();
}

/** The company's own read of its memories, so every assertion on screen can be checked against the store. */
async function readMemories(page: Page, companyId: string, query = ""): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`/api/v1/companies/${companyId}/memories?limit=100${query}`);
  expect(response.status(), "the company's own memory read").toBe(200);
  return ((await response.json()) as { memories: Array<Record<string, unknown>> }).memories;
}

/**
 * File a memory through the form, as a person would.
 *
 * A successful write triggers `router.refresh()`, which re-renders the form from the server. Waiting for the
 * count to reach `expect` before returning is what keeps a second write from racing that render — typed into an
 * input that is about to be replaced, the second value is lost and the form submits empty. The count is read from
 * the API rather than counted on screen, so the wait is on the write having happened rather than on a paint.
 */
async function remember(page: Page, fields: { companyId: string; expect: number; title: string; content: string; importance?: string }): Promise<void> {
  await page.getByPlaceholder("Title (e.g. Pricing decision)").fill(fields.title);
  await page.getByPlaceholder("Something every agent should remember").fill(fields.content);
  if (fields.importance) await page.getByLabel("Importance").selectOption({ label: fields.importance });
  await page.getByRole("button", { name: "Remember" }).click();
  await expect.poll(() => readMemories(page, fields.companyId).then((m) => m.length), { message: `“${fields.content}” is remembered` }).toBe(fields.expect);
  await expect(page.getByText(fields.content)).toBeVisible();
}

test("files a fact a person wrote, with its provenance, its band and no expiry", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const { id, base } = await company(page, "Memory Files");
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);

  await openMemory(page, base);
  // Nothing is remembered yet, and the page says which of the two situations it is in.
  await expect(page.getByText("Nothing remembered yet.")).toBeVisible();
  // No automatic memory is waiting on this deployment, and the queue is absent rather than empty-looking.
  await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
  checkpoint("the first load");

  await remember(page, { companyId: id, expect: 1, title: "Pricing decision", content: "We charge $49 a seat.", importance: "Important" });
  // The write is on the server before the re-render draws it: no amount of waiting fixes a lost write, and an
  // assertion that only read the browser would pass for a refresh that painted stale rows.
  const [stored] = await readMemories(page, id);
  expect(stored).toMatchObject({ title: "Pricing decision", content: "We charge $49 a seat.", importance: 8, sourceType: "user", expiresAt: null });

  await expect(page.getByText("Written by the founder", { exact: true })).toBeVisible();
  // The band the form offered, drawn from the column's own scale rather than a second opinion about it.
  await expect(page.getByTitle("importance 8 of 10")).toHaveText("Important");
  await expect(page.getByText(/^Confident · 90%$/)).toBeVisible();
  // What a person wrote does not lapse, so no expiry sentence is drawn for it.
  await expect(page.getByText(/expires in|expires tomorrow|^expired$/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Memory/ })).toContainText("1");
  await showMemoryTab(page);
  await expect(page.getByText("We charge $49 a seat.")).toBeVisible();
  checkpoint("filing a memory");

  expect(errors).toEqual([]);
});

test("corrects a memory keeping the words it replaced, and supersedes it keeping the old row readable", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const { id, base } = await company(page, "Memory Corrections");
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);

  await openMemory(page, base);
  await remember(page, { companyId: id, expect: 1, title: "Price", content: "We charge $39." });

  // Correct: the words change in place, and the page says who last touched it.
  await page.getByRole("button", { name: "Correct" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save correction" }) });
  await expect(form).toBeVisible();
  await form.locator('input[name="title"]').fill("Price");
  await form.locator('textarea[name="content"]').fill("We charge $49.");
  await form.getByRole("button", { name: "Save correction" }).click();

  // The store keeps the replaced words as a revision — the reason the table exists rather than a diff at render time.
  const [afterCorrect] = await readMemories(page, id);
  expect(afterCorrect).toMatchObject({ title: "Price", content: "We charge $49." });
  const read = await page.request.get(`/api/v1/companies/${id}/memories/${String(afterCorrect!.id)}`);
  expect(read.status()).toBe(200);
  const revisions = ((await read.json()) as { revisions: Array<{ content: string; reason: string }> }).revisions;
  expect(revisions.map((r) => r.content)).toContain("We charge $39.");

  await expect(page.getByText("We charge $49.")).toBeVisible();
  await expect(page.getByText("Corrected by a person", { exact: true })).toBeVisible();
  await expect(page.getByText("We charge $39.")).toHaveCount(0);
  checkpoint("correcting a memory");

  // The revision is visible on the page too, once the correction form asks for its history. The list prints what
  // the row was called and why the copy exists; the replaced words themselves are the row's older content.
  await page.getByRole("button", { name: "Correct" }).click();
  await form.getByRole("button", { name: "History" }).click();
  // The pill carries the reason and the revision's own title follows it; the replaced words stay in the store.
  const revision = page.getByText(/^corrected Price/);
  await expect(revision).toBeVisible();
  await expect(revision).toContainText("Price");
  await form.getByRole("button", { name: "Cancel" }).click();

  // Supersede: the fact is replaced rather than edited. The new statement is retrieved; the old one stays readable.
  await page.getByRole("button", { name: "Supersede" }).click();
  const replace = page.locator("form").filter({ has: page.getByRole("button", { name: "Supersede" }) });
  await replace.locator("textarea").fill("A seat is $59 a month.");
  // The replaced statement is written and the old row marked in one transaction; wait for the page's own call to
  // land rather than reading the store the instant the button is clicked.
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/memories\/[0-9a-f-]+\/supersede$/.test(r.url()) && r.status() === 201),
    replace.getByRole("button", { name: "Supersede" }).click(),
  ]);

  const live = await readMemories(page, id);
  expect(live.map((m) => m.content)).toEqual(["A seat is $59 a month."]);
  const oldId = String(afterCorrect!.id);
  const oldRow = await page.request.get(`/api/v1/companies/${id}/memories/${oldId}`);
  expect(oldRow.status()).toBe(200);
  const oldMemory = ((await oldRow.json()) as { memory: { supersededBy: string | null; content: string } }).memory;
  // The row is still there and still says what it said, and points at what replaced it.
  expect(oldMemory.content).toBe("We charge $49.");
  expect(oldMemory.supersededBy).not.toBeNull();
  // Retrieval does not see it, which is the whole difference between correcting and keeping a history.
  await expect(page.getByText("We charge $49.")).toHaveCount(0);
  await expect(page.getByText("A seat is $59 a month.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Memory/ })).toContainText("1");
  await showMemoryTab(page);
  await expect(page.getByText("A seat is $59 a month.")).toBeVisible();
  checkpoint("superseding a memory");

  expect(errors).toEqual([]);
});

test("merges two memories by selecting them, and only forgetting removes a row", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  const { id, base } = await company(page, "Memory Merges");
  const checkpoint = (where: string) => expect(errors, `browser errors by ${where}`).toEqual([]);

  await openMemory(page, base);
  await remember(page, { companyId: id, expect: 1, title: "Acme", content: "Acme is on the enterprise plan." });
  await remember(page, { companyId: id, expect: 2, title: "Acme again", content: "Acme renewed in March." });
  await expect(page.getByRole("button", { name: /^Memory/ })).toContainText("2");
  checkpoint("two memories filed");

  // Merge is offered only when exactly two rows are selected, because merging is a choice between two things.
  const boxes = page.getByLabel("Select for merge");
  await expect(page.getByRole("button", { name: "Merge selected" })).toHaveCount(0);
  await boxes.nth(0).check();
  await expect(page.getByRole("button", { name: "Merge selected" })).toHaveCount(0);
  await boxes.nth(1).check();
  await expect(page.getByText("Merge the two selected memories into one, keeping the first.")).toBeVisible();
  await page.getByRole("button", { name: "Merge selected" }).click();

  // Merge keeps the first row of the two that were selected — the newest, which is how the list is ordered — and
  // the one it absorbed is superseded rather than gone.
  const afterMerge = await readMemories(page, id);
  expect(afterMerge.map((m) => m.content)).toEqual(["Acme renewed in March."]);
  await expect(page.getByRole("button", { name: /^Memory/ })).toContainText("1");
  // The absorbed row leaves the list because it was superseded, which is the same move supersede makes.
  await expect(page.getByText("Acme is on the enterprise plan.")).toHaveCount(0);
  // The words of the memory that was folded in are kept as a revision, so a merge loses nothing.
  const merged = await page.request.get(`/api/v1/companies/${id}/memories/${String(afterMerge[0]!.id)}`);
  const mergedRevisions = ((await merged.json()) as { revisions: Array<{ content: string; reason: string }> }).revisions;
  expect(mergedRevisions.some((r) => r.content === "Acme is on the enterprise plan." && r.reason === "merged")).toBe(true);
  // The rows the list no longer draws are still in the store: a merge is not a delete.
  const absorbed = await page.request.get(`/api/v1/companies/${id}/memories?includeSuperseded=true&limit=100`);
  const all = ((await absorbed.json()) as { memories: Array<{ content: string; supersededBy: string | null }> }).memories;
  expect(all).toHaveLength(2);
  expect(all.find((m) => m.content === "Acme is on the enterprise plan.")).toMatchObject({ supersededBy: afterMerge[0]!.id });
  checkpoint("merging two memories");

  // Forget is destructive and is the only verb that takes a row out of the store.
  await page.getByRole("button", { name: "Forget" }).click();
  await expect.poll(async () => (await readMemories(page, id)).length).toBe(0);
  await expect(page.getByText("Nothing remembered yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Memory/ })).toContainText("0");
  await showMemoryTab(page);
  await expect(page.getByText("Nothing remembered yet.")).toBeVisible();
  checkpoint("forgetting a memory");

  expect(errors).toEqual([]);
});

test("opens on a phone without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  const { id, base } = await company(page, "Memory Phone");

  await openMemory(page, base);
  await remember(page, { companyId: id, expect: 1, title: "Pricing decision", content: "We charge $49 a seat.", importance: "Important" });
  // The correction form and the merge bar are the widest things this tab draws: a title, a paragraph, a select and
  // four buttons under one row.
  await page.getByRole("button", { name: "Correct" }).click();
  await expect(page.locator("form").filter({ has: page.getByRole("button", { name: "Save correction" }) })).toBeVisible();

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
  // and the Linux machine CI runs on. Only `main` is measured, because this bump widens the shell's own furniture.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "19px";
  });
  const withWiderText = await pastTheEdge();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  expect(withWiderText, `with wider text these reach past the phone: ${withWiderText.join(" | ")}`).toEqual([]);
});
