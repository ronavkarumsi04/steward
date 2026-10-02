import { expect, test, type Page } from "@playwright/test";
import { networkSettled, register, watchErrors } from "./session";

/**
 * The motion rules, driven in a real browser.
 *
 * A stylesheet cannot be trusted to have done what it says: it has to be observed. These tests watch the
 * product move and check the four promises the house makes — motion is only `transform` and `opacity`, every
 * arrival ends, nothing is hidden when motion is turned off, and a settling value lands exactly on its target
 * and leaves no frame requests behind. The last one is the reason this file exists: the frame loop's own
 * stopping is unit-tested against a fake clock in `src/lib/motion.test.ts`, and here it is measured against a
 * real browser by counting `requestAnimationFrame` calls the page makes while nothing is happening.
 */

/** Animations still running with a finite iteration count: an arrival that never finished. */
async function unfinishedArrivals(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names: string[] = [];
    for (const animation of document.getAnimations()) {
      if (animation.playState !== "running") continue;
      if (animation.effect?.getTiming().iterations === Infinity) continue; // a spinner is allowed to turn
      const name = (animation as CSSAnimation).animationName;
      names.push(typeof name === "string" ? name : "animation");
    }
    return names;
  });
}

/** The properties every current animation touches. */
async function animatedProperties(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const structural = new Set(["offset", "computedOffset", "easing", "composite", "cssOffset", "animationName"]);
    const touched = new Set<string>();
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      for (const frame of effect?.getKeyframes() ?? []) {
        for (const key of Object.keys(frame)) if (!structural.has(key)) touched.add(key);
      }
    }
    return [...touched].sort();
  });
}

const scaleX = (page: Page) =>
  page
    .locator("[data-motion-lab] .settle-bar")
    .evaluate((element) => {
      const written = getComputedStyle(element).transform.match(/^matrix\(([-\d.e]+)/);
      return written ? Number(written[1]) : Number.NaN;
    });

const settleValue = (page: Page) =>
  page.locator("[data-motion-lab] .settle").evaluate((element) => element.style.getPropertyValue("--settle"));

/** Let the page draw a few frames, so a value mid-flight can be read while it is moving. */
function waitFrames(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const tick = () => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/** Count the frames this page asks for, from the test side, without touching the product's code. */
async function countFrames(page: Page) {
  await page.evaluate(() => {
    const frames = window as unknown as { __motionFrames: number; requestAnimationFrame: typeof requestAnimationFrame };
    const original = frames.requestAnimationFrame.bind(window);
    frames.__motionFrames = 0;
    frames.requestAnimationFrame = (callback: FrameRequestCallback) => {
      frames.__motionFrames += 1;
      return original(callback);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __motionFrames: number }).__motionFrames);
}

test.describe.configure({ mode: "serial" });

test("with reduced motion nothing moves, and nothing is hidden", async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("link", { name: /get started|create|enter workspace/i }).first()).toBeVisible();
  await expect(page.getByText(/every step is recorded/i)).toBeVisible();
  // The banner is the last thing scheduled to arrive; under this preference it is simply there.
  await expect(page.getByText(/every step is recorded/i)).toHaveCSS("opacity", "1");

  const state = await page.evaluate(() => ({
    running: document.getAnimations().filter((animation) => animation.playState === "running").length,
    enhanced: document.querySelector("[data-motion]")?.getAttribute("data-motion"),
    hero: getComputedStyle(document.querySelector("[data-hero]") as Element).opacity,
  }));

  expect(state.enhanced).toBe("false");
  expect(state.hero).toBe("1");
  expect(state.running).toBe(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("the only properties this product moves are transform and opacity", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The landing page has finite entrances; its scroll choreography runs only in response to scrolling.
  const properties = await animatedProperties(page);
  expect(properties.length).toBeGreaterThan(0);
  for (const property of properties) {
    expect(["opacity", "transform"]).toContain(property);
  }
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("an arrival ends: nothing is left in flight once the shell has arrived", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  await expect(page.locator(".rise-in").first()).toBeVisible();

  // Entrances finish; only loops with no end are allowed to still be running.
  await expect.poll(() => unfinishedArrivals(page), { timeout: 10_000 }).toEqual([]);

  const landed = await page
    .locator(".rise-in")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: style.opacity, transform: style.transform };
    });
  expect(landed.opacity).toBe("1");
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(landed.transform);
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("a settling bar lands exactly on its value and leaves no frame requests behind", async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  await page.goto("/app/design");
  await expect(page.getByRole("heading", { name: "One house, on purpose." })).toBeVisible();
  await expect(page.locator("[data-motion-lab]")).toBeVisible();

  const frames = await countFrames(page);

  await page.getByRole("button", { name: "All of it" }).click();
  await expect.poll(scaleX.bind(null, page), { timeout: 5_000 }).toBeCloseTo(1, 4);
  expect(await settleValue(page)).toBe("1");

  // The loop's central promise: it does not run when nothing is moving.
  const afterLanding = await frames();
  expect(afterLanding).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await frames()).toBe(afterLanding);

  // A rescaled bar re-aims from where it is: it leaves the old value without jumping to the new one, never
  // overshoots, and lands on the number rather than near it.
  await page.getByRole("button", { name: "A quarter" }).click();
  await waitFrames(page, 3);
  const midway = await scaleX(page);
  expect(midway).toBeLessThan(1);
  expect(midway).toBeGreaterThan(0.25);
  await expect.poll(scaleX.bind(null, page), { timeout: 5_000 }).toBeCloseTo(0.25, 4);
  expect(await settleValue(page)).toBe("0.25");

  const afterRescale = await frames();
  await page.waitForTimeout(500);
  expect(await frames()).toBe(afterRescale);

  // Replaying the arrival re-mounts the bar, so it grows in from nothing and lands on the same value.
  await page.getByRole("button", { name: "Replay the arrival" }).click();
  await waitFrames(page, 3);
  const restarting = await scaleX(page);
  expect(restarting).toBeLessThan(0.25);
  expect(restarting).toBeGreaterThan(0);
  await expect.poll(scaleX.bind(null, page), { timeout: 5_000 }).toBeCloseTo(0.25, 4);
  expect(await settleValue(page)).toBe("0.25");

  // And the page it is on moves nothing but transform and opacity while all that happens.
  for (const property of await animatedProperties(page)) {
    expect(["opacity", "transform"]).toContain(property);
  }
  await networkSettled(page);
  expect(errors).toEqual([]);
});
