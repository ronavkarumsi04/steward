import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import RunPage from "@/app/app/c/[companyId]/runs/[runId]/page";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/server")>(), serverApi: async () => ({ get }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("keeps the inspector available when an optional task request fails", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  get.mockImplementation(async (path: string) => {
    if (path.endsWith("/tasks/task")) throw new ApiError(503, "unavailable", "Task store unavailable");
    if (path.endsWith("/runs/run")) return { run: { id: "run", taskId: "task" } };
    return { role: "owner" };
  });
  const page = await RunPage({ params: Promise.resolve({ companyId: "company", runId: "run" }), searchParams: Promise.resolve({}) });
  expect(page.props.initial.run.id).toBe("run");
  expect(page.props.task).toBeNull();
});
