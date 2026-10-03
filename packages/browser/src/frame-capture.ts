import type { Page } from "playwright";
import { BROWSER_LIMITS } from "./actions.js";

type CapturePage = Pick<Page, "screenshot" | "isClosed" | "waitForTimeout">;

/** Chromium can briefly lack a drawable surface after navigation. Never replay a browser action. */
export async function captureFrame(page: CapturePage) {
  for (let retries = 0; ; retries++) {
    try {
      const bytes = await page.screenshot({ type: "jpeg", quality: BROWSER_LIMITS.frameQuality, fullPage: false, animations: "disabled" });
      return { bytes, retries };
    } catch (error) {
      const transient = error instanceof Error && /Protocol error \(Page\.captureScreenshot\): Unable to capture screenshot/.test(error.message);
      if (!transient || page.isClosed() || retries >= 2) throw error;
      // Bounded compositor recovery: the next attempt must still produce actual image bytes.
      await page.waitForTimeout(150 * (retries + 1));
    }
  }
}
