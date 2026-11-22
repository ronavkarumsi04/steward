import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { friendly } from "./auth-form";

describe("auth error guidance", () => {
  it("explains capped signup and waitlist email and token errors", () => {
    expect(friendly(new ApiError(403, "signup_capped", "capped"))).toContain("join the waitlist");
    expect(friendly(new ApiError(400, "waitlist_email_mismatch", "mismatch"))).toContain("email address that received");
    expect(friendly(new ApiError(400, "invalid_waitlist_token", "invalid"))).toContain("expired, or already used");
  });
  it("keeps unavailable-email guidance generic for signup and verification", () => {
    expect(friendly(new ApiError(503, "email_unavailable", "unavailable"))).toBe("Email delivery is unavailable right now. No email was sent. Ask your organization admin for help.");
  });

  it("identifies password-reset email when that delivery is unavailable", () => {
    expect(friendly(new ApiError(503, "email_unavailable", "unavailable"), "Password-reset email")).toBe("Password-reset email is unavailable right now. No email was sent. Ask your organization admin for help.");
  });
});
