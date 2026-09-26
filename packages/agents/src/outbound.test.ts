import { describe, expect, it } from "vitest";
import { applyEmailCompliance, applySmsCompliance } from "./outbound.js";

const base = {
  appUrl: "https://app.steward.test",
  masterKey: "test-master-key",
  organizationId: "org-1",
  companyId: "co-1",
  recipient: "person@example.com",
  companyName: "Nimbus Analytics",
};

describe("marketing email compliance", () => {
  const marketing = applyEmailCompliance({ ...base, marketing: true, aiDisclosure: true, text: "Hello there" });

  it("adds a working unsubscribe link to the text body", () => {
    expect(marketing.text).toContain("https://app.steward.test/unsubscribe/");
    expect(marketing.unsubscribeUrl).toContain("https://app.steward.test/unsubscribe/");
  });

  it("adds the RFC 8058 one-click headers", () => {
    expect(marketing.headers["List-Unsubscribe"]).toBe(`<${marketing.unsubscribeUrl}>`);
    expect(marketing.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("includes an AI disclosure that names the sending organization", () => {
    expect(marketing.text).toContain("Nimbus Analytics");
    expect(marketing.text.toLowerCase()).toContain("ai agent");
  });

  it("builds an HTML alternative when the caller sent none", () => {
    expect(marketing.html).toContain("Unsubscribe");
    expect(marketing.html).toContain("<p");
  });

  it("preserves the original body verbatim as the first paragraph", () => {
    const long = "Line one about the product.\n\nLine two with a **markdown** marker and a URL: https://example.com/a?b=c\n\nLine three.";
    const out = applyEmailCompliance({ ...base, marketing: true, aiDisclosure: true, text: long });
    expect(out.text.split("\n\n— ")[0]).toBe(long);
    expect(out.text).toContain("https://example.com/a?b=c");
  });

  it("appends a footer to caller-provided HTML rather than replacing it", () => {
    const withHtml = applyEmailCompliance({ ...base, marketing: true, aiDisclosure: false, text: "hi", html: "<p>custom</p>" });
    expect(withHtml.html?.startsWith("<p>custom</p>")).toBe(true);
    expect(withHtml.html).toContain("Unsubscribe");
  });
});

describe("transactional email", () => {
  it("does not add an opt-out when there is no campaign", () => {
    const plain = applyEmailCompliance({ ...base, marketing: false, aiDisclosure: false, text: "Your build finished." });
    expect(plain.unsubscribeUrl).toBeNull();
    expect(plain.headers["List-Unsubscribe"]).toBeUndefined();
    expect(plain.text).toBe("Your build finished.");
  });

  it("still discloses AI authorship when asked, without an opt-out", () => {
    const disclosed = applyEmailCompliance({ ...base, marketing: false, aiDisclosure: true, text: "Your build finished." });
    expect(disclosed.unsubscribeUrl).toBeNull();
    expect(disclosed.text).toContain("AI agent");
  });
});

describe("sms compliance", () => {
  it("adds STOP and HELP instructions to marketing texts", () => {
    const body = applySmsCompliance({ companyName: "Nimbus Analytics", aiDisclosure: true, body: "Your trial ends Friday.", marketing: true });
    expect(body).toContain("Reply STOP to opt out, HELP for help.");
    expect(body).toContain("Nimbus Analytics");
  });

  it("omits opt-out instructions from transactional texts but keeps the disclosure", () => {
    const body = applySmsCompliance({ companyName: "Nimbus Analytics", aiDisclosure: true, body: "Your code is 123456.", marketing: false });
    expect(body).not.toContain("STOP");
    expect(body).toContain("AI assistant");
  });

  it("never exceeds the carrier limit", () => {
    const body = applySmsCompliance({ companyName: "Nimbus", aiDisclosure: true, body: "x".repeat(5000), marketing: true });
    expect(body.length).toBeLessThanOrEqual(1600);
  });
});
