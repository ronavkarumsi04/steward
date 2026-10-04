import { expect, it, vi } from "vitest";
import { WorkerResources } from "./lifecycle.js";

it("closes acquired resources once in reverse order even after a close fails", async () => {
  const resources = new WorkerResources();
  const closed: string[] = [];
  const report = vi.fn();
  resources.add("database", () => { closed.push("database"); });
  resources.add("temporal", () => { closed.push("temporal"); throw new Error("credential-bearing failure"); });
  resources.add("browser", async () => { closed.push("browser"); });
  await expect(resources.close(report)).rejects.toThrow("Worker resource cleanup failed");
  expect(closed).toEqual(["browser", "temporal", "database"]);
  expect(report).toHaveBeenCalledExactlyOnceWith("temporal");
  await resources.close(report);
  expect(closed).toHaveLength(3);
});
