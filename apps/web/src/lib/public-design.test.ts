import { describe, expect, it } from "vitest";
import { quietPublicEnabled } from "./public-design";

describe("public redesign preview gate", () => {
  it("requires an explicit opt-in in a preview environment", () => {
    expect(quietPublicEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    expect(quietPublicEnabled({ STEWARD_PUBLIC_DESIGN: "quiet" })).toBe(false);
    expect(quietPublicEnabled({ STEWARD_PUBLIC_DESIGN: "quiet", VERCEL_ENV: "preview" })).toBe(true);
    expect(quietPublicEnabled({ STEWARD_PUBLIC_DESIGN: "quiet", NODE_ENV: "development" })).toBe(true);
    expect(quietPublicEnabled({ STEWARD_PUBLIC_DESIGN: "quiet", STEWARD_PUBLIC_PREVIEW: "true" })).toBe(true);
  });
  it("rejects production even if every opt-in leaks into it", () => {
    expect(quietPublicEnabled({ VERCEL_ENV: "production", NODE_ENV: "development", STEWARD_PUBLIC_DESIGN: "quiet", STEWARD_PUBLIC_PREVIEW: "true" })).toBe(false);
  });
});
