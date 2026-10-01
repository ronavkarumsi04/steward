/**
 * `/health` names the commit it is running, because a hosted bundle that cannot say which commit it is
 * cannot be told apart from the one before it. The unit half lives here — no database, so it runs
 * everywhere; the deployed half is `scripts/hosted-check.sh`, which compares the field against a
 * repository and fails when the two disagree.
 */
import { describe, expect, it } from "vitest";
import { commitOf } from "./app.js";

describe("the commit /health reports", () => {
  it("is the short sha Vercel sets on the build and on the function", () => {
    expect(commitOf({ VERCEL_GIT_COMMIT_SHA: `ef63b83${"0".repeat(33)}` })).toBe("ef63b83");
  });

  it("falls back to GIT_COMMIT_SHA, which is how an image built here would say it", () => {
    expect(commitOf({ GIT_COMMIT_SHA: `C4FEF21${"1".repeat(33)}` })).toBe("c4fef21");
  });

  it("prefers the deployment's own commit when both are somehow set", () => {
    expect(commitOf({ VERCEL_GIT_COMMIT_SHA: `aaaaaaa${"0".repeat(33)}`, GIT_COMMIT_SHA: "b".repeat(40) })).toBe("aaaaaaa");
  });

  it("says unknown rather than guessing when nothing set it", () => {
    expect(commitOf({})).toBe("unknown");
    expect(commitOf({ VERCEL_GIT_COMMIT_SHA: "   " })).toBe("unknown");
  });

  it("refuses anything that is not a sha instead of printing it", () => {
    // A branch name, a tag, or a value cut short would make the field look answered while the check that
    // reads it compared two unrelated strings — the failure mode this field exists to remove.
    expect(commitOf({ VERCEL_GIT_COMMIT_SHA: "main" })).toBe("unknown");
    expect(commitOf({ VERCEL_GIT_COMMIT_SHA: "ef63b8" })).toBe("unknown");
    expect(commitOf({ VERCEL_GIT_COMMIT_SHA: "zzzzzzzz" })).toBe("unknown");
  });
});
