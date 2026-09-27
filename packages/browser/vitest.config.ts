import { defineConfig } from "vitest/config";

/**
 * These tests drive a real Chromium, and the first one to run pays for the whole cold start: launching the
 * browser, opening a context, and doing a first navigation on a machine that has never done it before. That is
 * several seconds of work which has nothing to do with the code under test, and it is the difference between a
 * passing run and a flake on a cold CI runner.
 *
 * So the timeout is a property of this package — it is the only package whose tests launch a browser — rather
 * than a number pushed onto every other package through a shared config.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
