import { afterEach, describe, expect, it, vi } from "vitest";
import { useActiveRefresh } from "./use-active-refresh";

const { refresh, effect } = vi.hoisted(() => ({ refresh: vi.fn(), effect: vi.fn() }));
vi.mock("react", () => ({ useEffect: effect }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("useActiveRefresh", () => {
  it("refreshes active work periodically and cleans up on completion or unmount", () => {
    vi.useFakeTimers();
    useActiveRefresh(true);
    const cleanup = effect.mock.calls[0]![0]();
    vi.advanceTimersByTime(6000);
    expect(refresh).toHaveBeenCalledTimes(2);
    cleanup();
    vi.advanceTimersByTime(6000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not schedule refreshes when nothing is active", () => {
    vi.useFakeTimers();
    useActiveRefresh(false);
    expect(effect.mock.calls[0]![0]()).toBeUndefined();
    vi.advanceTimersByTime(6000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
