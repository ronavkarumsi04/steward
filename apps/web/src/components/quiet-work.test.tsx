import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval, CompanyOverview, RunDetail, Task } from "@/lib/types";
import { QuietWork } from "./quiet-work";
import { QuietRunDetail } from "./quiet-run-detail";
import { QuietRunRecord } from "./quiet-run-record";
import { inspectRun } from "@/lib/run-inspection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const at = "2026-01-01T00:00:00Z";
const overview = { role: "owner", company: { id: "company", autonomyLevel: 1, timezone: "UTC" }, agents: [], budgets: [], policies: [] } as unknown as CompanyOverview;
const detail: RunDetail = { run: { id: "run", agentId: "agent", taskId: null, projectId: null, conversationId: null, trigger: {}, status: "executing", intent: "Check recorded evidence", plan: null, result: null, error: null, workflowId: null, costUsd: "", inputTokens: 0, outputTokens: 0, iterations: 0, createdAt: at, startedAt: at, finishedAt: null }, steps: [], aiCalls: [], toolCalls: [], artifacts: [], approvals: [], workflow: null };

describe("Quiet work surfaces", () => {
  it("composes plain approval timeline and Outcome copy without rewriting stored records or legacy inspection", () => {
    const request: Approval = { id: "pending-request", runId: detail.run.id, taskId: null, agentId: detail.run.agentId, action: "browser.act", reason: "external_write actions require approval at autonomy level 1", risk: "LOW", dimension: "external_write", payload: { kind: "wait", ms: 500 }, status: "pending", expiresAt: "2099-01-01T00:00:00Z", createdAt: at, affectedSystem: "the open page", alternatives: [], estimatedCostUsd: "0.0000", resolution: null, resolvedAt: null, resolvedBy: null };
    const record: RunDetail = { ...detail, run: { ...detail.run, status: "waiting_approval" }, approvals: [request] };
    const original = structuredClone(record);
    const html = renderToStaticMarkup(createElement(QuietRunRecord, { detail: record, companyId: "company", locale: "en", observedAt: Date.parse(at), timeZone: "UTC" }));
    expect(html).toContain("Paused for your approval: Wait 0.5 seconds in the browser");
    expect(html).toMatch(/<h3[^>]*>Wait 0.5 seconds in the browser<\/h3>/);
    expect(html).toContain("Request estimate: $0.00 USD");
    expect(html).not.toMatch(/browser\.act|external_write|est 0\.0000/);
    const legacy = inspectRun(record, { now: Date.parse(at), companyId: "company" });
    expect(legacy.timeline.find((entry) => entry.kind === "approval")?.title).toBe("browser.act");
    expect(legacy.verdict.headline).toBe("Paused for your approval: browser.act");
    const stored = { ...record, run: { ...record.run, result: { summary: "Stored browser.act narrative" } } };
    expect(renderToStaticMarkup(createElement(QuietRunRecord, { detail: stored, companyId: "company", locale: "en", observedAt: Date.parse(at), timeZone: "UTC" }))).toContain("Stored browser.act narrative");
    expect(record).toEqual(original);
  });
  it.each(["en", "es"] as const)("names approval actions under a run in plain words (%s), preserving bounded previews and review links", (locale) => {
    const request: Approval = { id: "wait-request", runId: detail.run.id, taskId: null, agentId: detail.run.agentId, action: "browser.act", reason: "external_write", risk: "LOW", dimension: "external_write", payload: { kind: "wait", ms: 500 }, status: "pending", expiresAt: "2099-01-01T00:00:00Z", createdAt: at, affectedSystem: "browser", alternatives: [], estimatedCostUsd: null, resolution: null, resolvedAt: null, resolvedBy: null };
    const email = { ...request, id: "email-request", action: "email.send", payload: { to: "review@example.com", subject: "Long recorded subject ".repeat(30) } };
    const html = renderToStaticMarkup(createElement(QuietRunRecord, { detail: { ...detail, approvals: [request, email] }, companyId: "company", locale, observedAt: Date.parse(at), timeZone: "UTC" }));
    const rows = [...html.matchAll(/<a class="q-work-row"[^>]*>[\s\S]*?<\/a>/g)].map(([row]) => row);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(locale === "en" ? "Wait 0.5 seconds in the browser" : "Esperar 0,5 segundos en el navegador");
    expect(rows[1]).toContain(locale === "en" ? "Send email to review@example.com" : "Enviar correo a review@example.com");
    expect(rows[0]).toContain("/approvals/wait-request");
    expect(rows[1]).toContain("/approvals/email-request");
    expect(rows.join("")).not.toMatch(/browser\.act|email\.send|external_write/);
    const preview = rows[1]!.match(/<strong>(.*?)<\/strong>/)![1]!;
    expect(Array.from(preview).length).toBeLessThanOrEqual(140);
    expect(preview.endsWith("…")).toBe(true);
  });
  it("retains records when assignment context fails, without claiming an empty list", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("/agents")) throw new Error("offline");
      if (path.includes("/runs?")) return { runs: [detail.run] };
      return overview;
    });
    const html = renderToStaticMarkup(await QuietWork({ companyId: "company", kind: "runs", filters: { status: "executing", taskId: "task" }, api: { get } as never, locale: "en" }));
    expect(html).toContain("Check recorded evidence");
    expect(html).toContain("Some work data could not be loaded");
    expect(html).toContain("Not available");
    expect(html).not.toContain("$0.00");
    expect(get.mock.calls[0]![0]).toContain("taskId=task");
    expect(html).toContain("from=");
  });
  it("does not turn a failed records read into empty work", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("/tasks?")) throw new Error("offline");
      if (path.endsWith("agents")) return { agents: [] };
      if (path.endsWith("goals")) return { goals: [] };
      return overview;
    });
    const html = renderToStaticMarkup(await QuietWork({ companyId: "company", kind: "tasks", filters: {}, api: { get } as never, locale: "en" }));
    expect(html).toContain("missing data is not an empty list");
    expect(html).not.toContain("No tasks in this view");
  });
  it("shows real empty traces, unavailable cost, and a measured cancel bar for active runs", () => {
    const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: detail, overview, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
    expect(html).toContain("No steps recorded yet");
    expect(html).toContain("No artifacts recorded yet");
    expect(html).toContain("Not available");
    expect(html).not.toContain("$0.00");
    expect(html).toContain('data-persistent="true"');
    expect(html).toContain("Cancel run");
  });
  it("separates a recorded title from its constraints and shows the linked goal without inventing usage", () => {
    const html = renderToStaticMarkup(createElement(QuietRunDetail, {
      companyId: "company", initial: { ...detail, run: { ...detail.run, taskId: "task", intent: "Draft a brief\n\nRead notes only.", costUsd: "0.000000" } },
      task: { id: "task", title: "Draft a brief", goalId: "goal" } as Task,
      overview: { ...overview, goals: [{ id: "goal", title: "Prepare the weekly brief" }] } as CompanyOverview,
      observedAt: Date.parse(at), back: "/app/c/company/runs",
    }));
    expect(html).toMatch(/<h1[^>]*>Draft a brief<\/h1>/);
    expect(html).toContain("Read notes only.");
    expect(html).toContain("Prepare the weekly brief");
    expect(html).toContain("Run details");
    expect(html).not.toContain("$0.00");
    expect(html.match(/Requests a stop to future work/g)).toHaveLength(1);
  });
  it("hides mutation controls for viewers, missing membership and terminal records", () => {
    for (const context of [null, { ...overview, role: "viewer" as const }]) {
      const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: detail, overview: context, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
      expect(html).not.toContain('data-persistent="true"');
    }
    const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: { ...detail, run: { ...detail.run, status: "failed", error: "Source read failed" } }, overview, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
    expect(html).toContain("Source read failed");
    expect(html).toContain("No automatic retry");
    expect(html).not.toContain('data-persistent="true"');
  });
  it("preserves a short recorded constraint after a leading newline", () => {
    const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: { ...detail, run: { ...detail.run, intent: "\nDo not send." } }, overview, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
    expect(html).toMatch(/<h1[^>]*>Run details<\/h1>/);
    expect(html).toContain("Do not send.");
  });
  it("keeps the timeline outside the existence of a result and exposes partial artifacts safely", () => {
    const html = renderToStaticMarkup(createElement(QuietRunRecord, { detail: { ...detail, artifacts: [{ id: "artifact", runId: "run", taskId: null, projectId: null, kind: "draft", title: "Partial source notes", url: "javascript:alert(1)", content: '{"summary":"Usable partial notes","apiKey":"must-not-render","reasoning":"private-reasoning"}', mimeType: "application/json", metadata: {}, createdAt: at }] }, companyId: "company", locale: "en", observedAt: Date.parse(at), timeZone: "UTC" }));
    expect(html).toContain("Run timeline");
    expect(html).toContain("Partial source notes");
    expect(html).toContain("Usable partial notes");
    expect(html).not.toContain("must-not-render");
    expect(html).not.toContain("private-reasoning");
    expect(html).not.toContain("javascript:");
  });
});
