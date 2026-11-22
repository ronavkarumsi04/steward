import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "./settings";
import type { Budget, Company } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./brand-kit-settings", () => ({ BrandKitSettings: () => null }));
vi.mock("./overclock", () => ({ OverclockToggle: () => null }));

const company: Company = { id: "company", organizationId: "org", name: "Local QA", slug: "local-qa", status: "active", autonomyLevel: 0, outboundPaused: false, timezone: "UTC", quietHours: null, settings: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
function renderBudget(remainingUsd: Budget["remainingUsd"]) {
  const budget: Budget = { category: "total", period: "monthly", limitUsd: 100, spentUsd: 125, reservedUsd: 0, remainingUsd, softThresholdPct: 80, hardStop: true, exhausted: true, overSoftThreshold: true };
  return renderToStaticMarkup(<SettingsPanel company={company} profile={null} policies={[]} goals={[]} budgets={[budget]} isAdmin quiet />);
}

it("shows a recorded budget deficit instead of treating an overrun as missing", () => {
  expect(renderBudget(-25)).toContain("-$25.00");
  expect(renderBudget(-0.0024)).toContain("-$0.0024");
});

it("still distinguishes zero and unavailable remaining budget values", () => {
  expect(renderBudget(0)).toContain(">$0.00</td>");
  expect(renderBudget(null as unknown as number)).toContain(">Not available</td>");
  expect(renderBudget(Number.NaN)).toContain(">Not available</td>");
});
