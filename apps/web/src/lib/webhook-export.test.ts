import { afterEach, expect, it, vi } from "vitest";
import { copyWebhookUrl, downloadWebhookUrl } from "./webhook-export";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("handles missing and denied clipboard access without throwing or displaying the URL", async () => {
  vi.stubGlobal("navigator", {});
  expect(await copyWebhookUrl("https://example.test/credential")).toBe(false);
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  expect(await copyWebhookUrl("https://example.test/credential")).toBe(false);
  writeText.mockResolvedValue(undefined);
  expect(await copyWebhookUrl("https://example.test/credential")).toBe(true);
});

it("downloads a webhook without placing its credential in the DOM", async () => {
  vi.useFakeTimers();
  let blob: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:temporary"; });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("document", { createElement: () => link, body: { appendChild: vi.fn() } });
  downloadWebhookUrl("https://example.test/credential");
  expect(await blob!.text()).toBe("https://example.test/credential");
  expect(link.href).toBe("blob:temporary");
  expect(link.download).toBe("steward-webhook.txt");
  expect(link.click).toHaveBeenCalled();
  expect(link.remove).toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith("blob:temporary");
});
