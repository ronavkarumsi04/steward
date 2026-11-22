import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import CompanyLayout from "@/app/app/c/[companyId]/layout";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server")>(),
  serverApi: async () => ({ get }), getLocale: async () => "en", requireMe: async () => ({ user: { id: "owner" } }),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
const overview = { company: { id: "company", organizationId: "org" }, pendingApprovals: 0 };

it("does not depend on the legacy active-runs count in the Quiet layout", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  get.mockImplementation(async (path: string) => {
    if (path.includes("/runs?")) throw new ApiError(503, "unavailable", "Run list unavailable");
    return overview;
  });
  const page = await CompanyLayout({ children: "run inspector", params: Promise.resolve({ companyId: "company" }) });
  expect(page).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith("/companies/company");
});

it("retains the existing active-runs read for the legacy sidebar", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "legacy");
  get.mockImplementation(async (path: string) => path.includes("/runs?") ? { runs: [] } : overview);
  await CompanyLayout({ children: "legacy work", params: Promise.resolve({ companyId: "company" }) });
  expect(get).toHaveBeenCalledWith("/companies/company/runs?status=executing,planning,building_context,verifying&limit=20");
});
