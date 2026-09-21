import { describe, expect, it } from "vitest";
import pino from "pino";
import { parseBoolean } from "./context.js";
import { ConsoleMailer, MailerError, ResendMailer, createMailer, mailerConfigFromEnv, renderEmail } from "./mailer.js";

const silent = pino({ level: "silent" });

describe("parseBoolean", () => {
  it("accepts common spellings and falls back on empty", () => {
    for (const v of ["1", "true", "TRUE", "yes", " on "]) expect(parseBoolean(v, false)).toBe(true);
    for (const v of ["0", "false", "No", "off"]) expect(parseBoolean(v, true)).toBe(false);
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean("", false)).toBe(false);
    expect(() => parseBoolean("maybe", true)).toThrow(/boolean/);
  });
});

describe("mailer configuration", () => {
  it("defaults to the console provider and rejects unknown providers", () => {
    expect(mailerConfigFromEnv({})).toEqual({ provider: "console", from: "Steward <no-reply@localhost>" });
    expect(createMailer(silent, {})).toBeInstanceOf(ConsoleMailer);
    expect(() => mailerConfigFromEnv({ PLATFORM_EMAIL_PROVIDER: "sendgrid" })).toThrow(/Unsupported/);
  });

  it("requires RESEND_API_KEY for resend", () => {
    expect(() => createMailer(silent, { PLATFORM_EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(createMailer(silent, { PLATFORM_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", PLATFORM_EMAIL_FROM: "Steward <hi@example.com>" })).toBeInstanceOf(ResendMailer);
  });
});

describe("ResendMailer", () => {
  it("posts the message with bearer auth and surfaces API errors", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 200;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(status === 200 ? '{"id":"1"}' : '{"message":"invalid from"}', { status });
    }) as typeof fetch;
    const m = new ResendMailer({ apiKey: "re_secret", from: "Steward <hi@example.com>", fetchImpl });
    await m.send({ to: "a@example.com", subject: "Hi", text: "plain", html: "<p>plain</p>" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_secret");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "Steward <hi@example.com>", to: ["a@example.com"], subject: "Hi", text: "plain", html: "<p>plain</p>" });
    status = 422;
    await expect(m.send({ to: "a@example.com", subject: "Hi", text: "plain" })).rejects.toBeInstanceOf(MailerError);
  });
});

describe("renderEmail", () => {
  it("escapes HTML and keeps the raw link in the text part", () => {
    const { text, html } = renderEmail({ title: "Reset <now>", intro: "Tom & Jerry", actionLabel: "Go", actionUrl: "https://x.test/r/abc?x=1&y=2", footer: "bye" });
    expect(text).toContain("https://x.test/r/abc?x=1&y=2");
    expect(html).toContain("Reset &lt;now&gt;");
    expect(html).toContain("Tom &amp; Jerry");
    expect(html).not.toContain("<now>");
    expect(html).toContain('href="https://x.test/r/abc?x=1&amp;y=2"');
  });
});
