import { describe, expect, it } from "vitest";
import { humanAction, pushConfigFromEnv } from "./push.js";

describe("push config", () => {
  it("is off until both VAPID keys are present, and derives a subject from APP_URL", () => {
    expect(pushConfigFromEnv({ VAPID_PUBLIC_KEY: "pub" })).toBeNull();
    const cfg = pushConfigFromEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", APP_URL: "https://steward.example/" });
    expect(cfg).toMatchObject({ publicKey: "pub", privateKey: "priv", subject: "mailto:ops@steward.example", appUrl: "https://steward.example" });
    expect(pushConfigFromEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:me@x.io" })!.subject).toBe("mailto:me@x.io");
  });

  it("reads tool names the way a phone should", () => {
    expect(humanAction("email.send")).toBe("Email send");
    expect(humanAction("company.brand_update")).toBe("Company brand update");
  });
});
