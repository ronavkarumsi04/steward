import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { friendly } from "./auth-form";

describe("auth error guidance", () => {
  it("keeps unavailable-email guidance generic for signup and verification", () => {
    expect(friendly(new ApiError(503, "email_unavailable", "unavailable"))).toBe("Email delivery is unavailable right now. No email was sent. Ask your organization admin for help.");
  });

  it("identifies password-reset email when that delivery is unavailable", () => {
    expect(friendly(new ApiError(503, "email_unavailable", "unavailable"), "Password-reset email")).toBe("Password-reset email is unavailable right now. No email was sent. Ask your organization admin for help.");
  });
});
