import { describe, expect, it } from "vitest";
import { LAUNCH_KIT_MIN_TASKS, LAUNCH_KIT_TITLES, launchKitBrief, launchKitProgress } from "./launch-kit.js";

describe("launch kit brief", () => {
  it("carries the founder's own words and demands the exact deliverable titles", () => {
    const brief = launchKitBrief({
      name: "Ledgerline",
      description: "Bookkeeping that closes itself for two-person agencies",
      stage: "prototype",
      businessModel: "",
      targetCustomers: ["design agencies", " freelancers "],
      constraints: ["no paid ads"],
    });
    expect(brief).toContain("Launch kit for Ledgerline");
    expect(brief).toContain("Bookkeeping that closes itself");
    expect(brief).toContain("design agencies; freelancers");
    expect(brief).toContain("undecided — propose one");
    expect(brief).toContain("no paid ads");
    for (const title of Object.values(LAUNCH_KIT_TITLES)) expect(brief).toContain(`title "${title}"`);
    expect(brief).toContain(`task.create — ${LAUNCH_KIT_MIN_TASKS} week-one tasks`);
    expect(brief).toContain("company.brand_update");
    expect(brief).toContain("indigo, violet, emerald, amber, rose, slate, cyan");
    expect(brief).not.toContain("null");
  });

  it("says so when the founder gave almost nothing", () => {
    const brief = launchKitBrief({ name: "Acme" });
    expect(brief).toContain("(not provided — infer from the name and say so)");
    expect(brief).toContain("Constraints: none given");
  });
});

describe("launch kit progress", () => {
  const doc = (title: string, id = "doc_1", status = "succeeded") => ({
    toolName: "document.write",
    input: { title, content: "..." },
    output: { content: `Saved document ${title} (${id})` },
    status,
  });

  it("marks a deliverable done only from a succeeded tool call, and links the document", () => {
    const progress = launchKitProgress([
      doc("Positioning", "doc_pos"),
      doc("Brand brief", "doc_brand", "failed"),
      { toolName: "decision.record", input: { title: "Target customer: two-person agencies" }, output: null, status: "succeeded" },
      ...Array.from({ length: 3 }, (_, i) => ({ toolName: "task.create", input: { title: `Task ${i}` }, output: null, status: "succeeded" })),
    ]);
    const by = Object.fromEntries(progress.map((p) => [p.id, p]));
    expect(by.positioning).toMatchObject({ status: "done", evidence: "Positioning", documentId: "doc_pos" });
    expect(by.brand).toMatchObject({ status: "pending", evidence: null });
    expect(by.kit).toMatchObject({ status: "pending", evidence: null });
    expect(by.landing?.status).toBe("pending");
    expect(by.decision).toMatchObject({ status: "done", evidence: "Target customer: two-person agencies" });
    expect(by.tasks).toMatchObject({ status: "pending", evidence: `3 of ${LAUNCH_KIT_MIN_TASKS} created` });
  });

  it("tolerates a model that paraphrases a title, and completes with enough tasks", () => {
    const progress = launchKitProgress([
      doc("Landing Page Copy — v1"),
      doc("Brand Brief"),
      doc("Positioning"),
      { toolName: "company.brand_update", input: { accent: "emerald", voice: { tone: ["plain", "warm"] } }, output: null, status: "failed" },
      { toolName: "company.brand_update", input: { tagline: "Books that close themselves", accent: "emerald" }, output: null, status: "succeeded" },
      { toolName: "decision.record", input: { decision: "SMBs" }, output: null, status: "succeeded" },
      ...Array.from({ length: LAUNCH_KIT_MIN_TASKS }, () => ({ toolName: "task.create", input: {}, output: null, status: "succeeded" })),
    ]);
    expect(progress.every((p) => p.status === "done")).toBe(true);
    expect(progress.find((p) => p.id === "tasks")?.evidence).toBe(`${LAUNCH_KIT_MIN_TASKS} created`);
    expect(progress.find((p) => p.id === "kit")?.evidence).toBe("Books that close themselves");
  });

  it("describes a saved brand kit by its tone when it has no tagline, and ignores a failed save", () => {
    const failed = launchKitProgress([{ toolName: "company.brand_update", input: { tagline: "Nope" }, output: null, status: "failed" }]);
    expect(failed.find((p) => p.id === "kit")).toMatchObject({ status: "pending", evidence: null });
    const toned = launchKitProgress([{ toolName: "company.brand_update", input: { voice: { tone: ["plain", "exact"] } }, output: null, status: "succeeded" }]);
    expect(toned.find((p) => p.id === "kit")).toMatchObject({ status: "done", evidence: "plain, exact" });
  });

  it("is all pending with no ledger", () => {
    expect(launchKitProgress([]).every((p) => p.status === "pending" && p.evidence === null)).toBe(true);
  });
});
