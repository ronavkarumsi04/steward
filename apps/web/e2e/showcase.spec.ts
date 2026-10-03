import { test, expect, type Page } from "@playwright/test";
import { watchErrors, networkSettled } from "./session";

async function scrollProgress(page: Page, section: string, fraction: number) {
  await page.locator(section).evaluate((node, p) => {
    const rect = node.getBoundingClientRect();
    window.scrollTo(
      0,
      scrollY + rect.top - 76 + p * (rect.height - innerHeight + 76),
    );
  }, fraction);
}
const transform = (page: Page, selector: string) =>
  page.locator(selector).evaluate((node) => getComputedStyle(node).transform);

test("desktop zoom, native chapter scrolling, keyboard navigation and sideways showcase", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator("[data-motion]")).toHaveAttribute(
    "data-motion",
    "true",
  );
  await scrollProgress(page, "[data-zoom]", 0);
  const before = await transform(page, "[data-product-canvas]");
  const wrapper = page.locator("[data-product-canvas]").locator("..");
  const initial = await wrapper.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  await scrollProgress(page, "[data-zoom]", 1);
  await expect
    .poll(() => wrapper.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe(initial);
  // The owned illustration is untouched; movement happens on its wrapper.
  expect(await transform(page, "[data-product-canvas]")).toBe(before);
  for (const [fraction, title] of [
    [0, "Start with intent."],
    [0.3, "Make it tangible."],
    [0.55, "Evidence over instinct."],
    [0.8, "You call the shots."],
  ] as const) {
    await scrollProgress(page, "[data-story]", fraction);
    await expect(
      page.locator('[data-chapter-panel][data-active="true"]'),
    ).toContainText(title);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-chapter-panel][aria-hidden="true"]'),
    ).toHaveCount(3);
  }
  const chapter = page.getByRole("link", { name: /02 Build in context/ });
  await chapter.focus();
  await page.keyboard.press("Enter");
  await expect(chapter).toHaveAttribute("aria-current", "step");
  await expect(page).toHaveURL(/#build$/);
  await expect(
    page.getByRole("heading", { name: "Make it tangible." }),
  ).toBeVisible();
  await scrollProgress(page, "[data-rail]", 0);
  await expect
    .poll(() => transform(page, "[data-track]"))
    .toBe("matrix(1, 0, 0, 1, 0, 0)");
  await scrollProgress(page, "[data-rail]", 1);
  await expect
    .poll(() =>
      page
        .locator("#company-memory")
        .evaluate((node) => node.getBoundingClientRect().right),
    )
    .toBeLessThan(1441);
  expect(
    await page
      .locator("#company-memory")
      .evaluate((node) => node.getBoundingClientRect().left),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("deep links select their chapter and idle motion requests no continuing frames", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#verify");
  await expect(
    page.locator('[data-chapter-panel][data-active="true"]'),
  ).toHaveAttribute("id", "verify");
  await page.evaluate(() => {
    const w = window as unknown as {
      __frames: number;
      requestAnimationFrame: typeof requestAnimationFrame;
    };
    const original = w.requestAnimationFrame.bind(window);
    w.__frames = 0;
    w.requestAnimationFrame = (callback) => {
      w.__frames++;
      return original(callback);
    };
  });
  // Allow resize/scroll events caused by initial navigation to settle, then measure a quiet interval.
  await page.waitForTimeout(500);
  const count = () =>
    page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  const start = await count();
  await page.waitForTimeout(500);
  expect(await count()).toBe(start);
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("reduced motion can be enabled live without hiding the chapter or trapping content", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('[data-chapter-link="2"]').click();
  await expect(page.locator("#verify")).toHaveAttribute("data-active", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-motion]")).toHaveAttribute(
    "data-motion",
    "false",
  );
  for (const title of [
    "Start with intent.",
    "Make it tangible.",
    "Evidence over instinct.",
    "You call the shots.",
  ])
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  expect(
    await page
      .locator("#verify")
      .evaluate((node) => node.getBoundingClientRect().top),
  ).toBeLessThan(150);
  await expect(page.locator("[data-chapter-panel][inert]")).toHaveCount(0);
  await expect(page.locator("[data-chapter-panel][aria-hidden]")).toHaveCount(
    0,
  );
  expect(await transform(page, "[data-track]")).toBe("none");
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("mobile has readable vertical chapters, accessible anchor navigation and no overflow", async ({
  page,
}) => {
  const errors = watchErrors(page);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator("[data-motion]")).toHaveAttribute(
      "data-motion",
      "false",
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
    await page.locator('[data-chapter-link="3"]').click();
    await expect(page).toHaveURL(/#decide$/);
    await expect
      .poll(() =>
        page
          .locator("#decide")
          .evaluate((node) => node.getBoundingClientRect().top),
      )
      .toBeLessThan(151);
    await expect(
      page.getByRole("heading", { name: "You call the shots." }),
    ).toBeVisible();
    const positions = await page
      .locator("[data-track] > article")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().top),
      );
    expect(positions[1]).toBeGreaterThan(positions[0]!);
    expect(positions[2]).toBeGreaterThan(positions[1]!);
  }
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("without JavaScript the full story and useful destinations remain available", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // Chromium intentionally refuses the document's script preload when JavaScript is disabled.
  // Require that refusal to occur; HTTP failures and all other refused requests remain failures.
  const errors = watchErrors(page, {
    expect: [
      { method: "GET", path: /^\/_next\/static\/.*\.js$/, reason: "csp" },
    ],
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-chapter-panel]")).toHaveCount(4);
  await page.locator('[data-chapter-link="2"]').click();
  await expect(
    page.getByRole("heading", { name: "Evidence over instinct." }),
  ).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "API reference" }),
  ).toHaveAttribute("href", "/api/v1/openapi.json");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
  await networkSettled(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("short viewports stay vertical; compact desktop scenes fit below navigation", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto("/");
  await expect(page.locator("[data-motion]")).toHaveAttribute(
    "data-motion",
    "false",
  );
  await expect(page.locator("[data-chapter-panel][inert]")).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator("[data-motion]")).toHaveAttribute(
    "data-motion",
    "true",
  );
  for (let index = 0; index < 4; index++) {
    await page.locator(`[data-chapter-link="${index}"]`).click();
    await expect(
      page.locator('[data-chapter-panel][data-active="true"]'),
    ).toHaveCSS("opacity", "1");
    const bounds = await page
      .locator('[data-chapter-panel][data-active="true"]')
      .evaluate((node) => ({
        top: node.getBoundingClientRect().top,
        bottom: node
          .querySelector("[class*=chapterCopy]")!
          .getBoundingClientRect().bottom,
      }));
    expect(bounds.top).toBeGreaterThanOrEqual(76);
    expect(bounds.bottom).toBeLessThanOrEqual(768);
    const object = await page
      .locator("[data-folio-assembly]")
      .evaluate((node) => {
        const sheets = [...node.children].map((sheet) =>
          sheet.getBoundingClientRect(),
        );
        return {
          top: Math.min(...sheets.map((rect) => rect.top)),
          bottom: Math.max(...sheets.map((rect) => rect.bottom)),
        };
      });
    expect(object.top).toBeGreaterThan(bounds.bottom);
    expect(object.bottom).toBeLessThanOrEqual(768);
  }
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("the same folio moves continuously inside a chapter and carries its leaves through all four states", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const folio = page.locator("[data-folio-assembly]");
  await folio.evaluate((node) => {
    (window as unknown as { folio: Element }).folio = node;
  });
  const poses: string[] = [];
  for (const fraction of [0.08, 0.12, 0.17, 0.3, 0.55, 0.8, 1]) {
    await scrollProgress(page, "[data-story]", fraction);
    await expect
      .poll(() =>
        page
          .locator("[data-journey-object]")
          .getAttribute("data-sc-verify-state"),
      )
      .not.toBeNull();
    const previous = poses.at(-1);
    if (previous)
      await expect
        .poll(() => transform(page, "[data-folio-assembly]"))
        .not.toBe(previous);
    poses.push(await transform(page, "[data-folio-assembly]"));
    expect(
      await folio.evaluate(
        (node) => node === (window as unknown as { folio: Element }).folio,
      ),
    ).toBe(true);
    await expect(page.locator("[data-journey-object]")).toBeVisible();
    await expect(page.locator("[data-folio-face]")).toHaveCount(4);
  }
  expect(new Set(poses).size).toBe(poses.length);
  expect(
    await page
      .locator('[data-folio-face="3"]')
      .evaluate((node) => getComputedStyle(node).opacity),
  ).toBe("1");
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("section navigation travels through intermediate scroll positions and preserves hash history", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { travel: number[] }).travel = samples;
    window.addEventListener("scroll", () => samples.push(Math.round(scrollY)), {
      passive: true,
    });
  });
  await page
    .getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "The story" })
    .click();
  await expect(page).toHaveURL(/#story$/);
  await expect
    .poll(() =>
      page
        .locator("#story")
        .evaluate((node) => Math.abs(node.getBoundingClientRect().top - 76)),
    )
    .toBeLessThan(2);
  const samples = await page.evaluate(
    () => (window as unknown as { travel: number[] }).travel,
  );
  expect(new Set(samples).size).toBeGreaterThan(4);
  await page.locator('[data-chapter-link="2"]').click();
  await expect(page.locator("#verify")).toHaveAttribute("data-active", "true");
  await page.goBack();
  await expect(page).toHaveURL(/#story$/);
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("page fades keep real destinations, settle after navigation and respect reduced motion and unsupported browsers", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document);
    (window as unknown as { fades: number }).fades = 0;
    if (original)
      document.startViewTransition = ((callback: () => Promise<void>) => {
        (window as unknown as { fades: number }).fades++;
        return original(callback);
      }) as typeof document.startViewTransition;
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Terms of Service",
  );
  expect(
    await page.evaluate(() => (window as unknown as { fades: number }).fades),
  ).toBe(1);
  await expect(page.locator("html")).toHaveAttribute(
    "data-page-transition",
    "idle",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  expect(
    await page.evaluate(() => (window as unknown as { fades: number }).fades),
  ).toBe(1);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() =>
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    }),
  );
  await page
    .getByRole("link", { name: "Terms of Service", exact: true })
    .click();
  await expect(page).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Terms of Service",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  await page.evaluate(() =>
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: () => {
        throw new Error("Snapshots refused in this document");
      },
    }),
  );
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Big ideas.",
  );
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("a delayed page stays navigable and switching motion off cancels its snapshot without cancelling the destination", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/legal/terms");
  await page.route("**/legal/privacy*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-page-transition",
    "idle",
  );
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Privacy Policy",
  );
  await networkSettled(page);
  expect(errors).toEqual([]);
});

test("the shared brand and downloadable logo assets survive production packaging", async ({
  page,
  request,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  const path = await page
    .locator('a[aria-label="Steward home"] svg path')
    .getAttribute("d");
  expect(path).toBeTruthy();
  for (const asset of [
    "steward-symbol.svg",
    "steward-symbol-inverse.svg",
    "steward-lockup.svg",
  ]) {
    const response = await request.get(`/brand/${asset}`);
    expect(response.status(), asset).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
    expect(await response.text()).toContain(path!);
  }
  for (const asset of [
    "/icon.svg",
    "/apple-icon",
    "/opengraph-image",
    "/manifest.webmanifest",
  ]) {
    expect((await request.get(asset)).status(), asset).toBe(200);
  }
  await networkSettled(page);
  expect(errors).toEqual([]);
});
