import { describe, expect, it, vi } from "vitest";
import { captureFrame } from "./frame-capture.js";

const transient = () => new Error("page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot");
function page() {
  return { screenshot: vi.fn(async () => Buffer.from("captured bytes")), isClosed: vi.fn(() => false), waitForTimeout: vi.fn(async (_ms: number) => undefined) };
}

describe("bounded Chromium frame recovery", () => {
  it("retries the known compositor error and returns only bytes from a successful capture", async () => {
    const p = page();
    p.screenshot.mockRejectedValueOnce(transient());
    expect(await captureFrame(p)).toEqual({ bytes: Buffer.from("captured bytes"), retries: 1 });
    expect(p.screenshot).toHaveBeenCalledTimes(2);
    expect(p.waitForTimeout).toHaveBeenCalledWith(150);
  });
  it("does not retry other errors or invent a frame", async () => {
    const p = page(); const error = new Error("screenshot timed out");
    p.screenshot.mockRejectedValue(error);
    await expect(captureFrame(p)).rejects.toBe(error);
    expect(p.screenshot).toHaveBeenCalledOnce();
    expect(p.waitForTimeout).not.toHaveBeenCalled();
  });
  it("fails after three unsuccessful captures", async () => {
    const p = page(); const error = transient(); p.screenshot.mockRejectedValue(error);
    await expect(captureFrame(p)).rejects.toBe(error);
    expect(p.screenshot).toHaveBeenCalledTimes(3);
    expect(p.waitForTimeout.mock.calls.map(([ms]) => ms)).toEqual([150, 300]);
  });
  it("never retries a closed page", async () => {
    const p = page(); const error = transient(); p.isClosed.mockReturnValue(true); p.screenshot.mockRejectedValue(error);
    await expect(captureFrame(p)).rejects.toBe(error);
    expect(p.screenshot).toHaveBeenCalledOnce();
    expect(p.waitForTimeout).not.toHaveBeenCalled();
  });
});
