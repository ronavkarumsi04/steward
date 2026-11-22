import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Approval, RunDetail } from "@/lib/types";
import { RunDetailView } from "./run-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/use-events", () => ({ useLiveEvents: () => ({ events: [] }) }));

it("moves stale pending approvals on cancelled runs into closed history", () => {
  const approval = { id: "approval", action: "email.send", status: "pending" } as Approval;
  const initial = { run: { id: "run", status: "cancelled", trigger: {}, intent: "Cancelled work", costUsd: "0", iterations: 0, inputTokens: 0, outputTokens: 0, createdAt: "2026-01-01T00:00:00Z" }, steps: [], aiCalls: [], toolCalls: [], artifacts: [], approvals: [approval], workflow: null } as unknown as RunDetail;
  const html = renderToStaticMarkup(createElement(RunDetailView, { companyId: "company", initial, agents: [], observedAt: Date.parse("2026-01-01T00:00:00Z") }));
  expect(html).toContain("Approval history");
  expect(html).toContain("Cancelled — the run was cancelled before a decision");
  expect(html).not.toContain("Waiting for your approval");
  expect(html).not.toMatch(/<button[^>]*>Approve/);
});
