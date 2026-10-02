import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowConnection } from "./workflow-connection.js";

afterEach(() => vi.useRealTimers());

function setup(connect = vi.fn(async () => ({ close: vi.fn(async () => {}) })), disabled = false) {
  const onUnavailable = vi.fn();
  const onConnected = vi.fn();
  const connection = new WorkflowConnection({ connect, disabled, retryMs: 30_000, onUnavailable, onConnected });
  return { connection, connect, onUnavailable, onConnected };
}

describe("workflow connection recovery", () => {
  it("retries a failed boot and shares the recovered client with every caller", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.connect.mockRejectedValueOnce(new Error("unavailable"));
    await s.connection.ensure();
    expect(s.connection.current).toBeNull();
    expect(s.onUnavailable).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.connection.current).not.toBeNull();
    expect(s.onConnected).toHaveBeenCalledTimes(1);
    await s.connection.close();
  });

  it("deduplicates requests while connecting and respects the retry cooldown", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.connect.mockRejectedValue(new Error("unavailable"));
    await Promise.all([s.connection.ensure(), s.connection.ensure(), s.connection.ensure()]);
    expect(s.connect).toHaveBeenCalledTimes(1);
    await Promise.all([s.connection.ensure(), s.connection.ensure()]);
    expect(s.connect).toHaveBeenCalledTimes(1);
    await s.connection.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it("does not connect when explicitly disabled", async () => {
    const s = setup(undefined, true);
    await s.connection.ensure();
    expect(s.connection.current).toBeNull();
    expect(s.connect).not.toHaveBeenCalled();
    await s.connection.close();
  });

  it("closes a connection that arrives after shutdown rather than resurrecting the runtime", async () => {
    const client = { close: vi.fn(async () => {}) };
    let resolve!: (value: typeof client) => void;
    const s = setup(vi.fn(() => new Promise<typeof client>((done) => { resolve = done; })));
    const connecting = s.connection.ensure();
    const closing = s.connection.close();
    resolve(client);
    await Promise.all([connecting, closing]);
    expect(s.connection.current).toBeNull();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(s.onConnected).not.toHaveBeenCalled();
  });

  it("propagates shutdown failures instead of swallowing them", async () => {
    const client = { close: vi.fn(async () => { throw new Error("close failed"); }) };
    const s = setup(vi.fn(async () => client));
    await s.connection.ensure();
    await expect(s.connection.close()).rejects.toThrow("close failed");
  });
});
