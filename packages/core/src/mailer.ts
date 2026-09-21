import type pino from "pino";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Platform (not agent) email: invitations, password resets, verification. */
export interface Mailer {
  readonly provider: "console" | "resend";
  send(message: MailMessage): Promise<void>;
}

export class MailerError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MailerError";
  }
}

/** Logs the message instead of delivering it; the default in development so links are visible in the API log. */
export class ConsoleMailer implements Mailer {
  readonly provider = "console" as const;
  constructor(private readonly log: pino.Logger) {}
  async send(message: MailMessage) {
    this.log.info({ to: message.to, subject: message.subject, text: message.text }, "platform email (console provider)");
  }
}

export class ResendMailer implements Mailer {
  readonly provider = "resend" as const;
  constructor(
    private readonly opts: { apiKey: string; from: string; fetchImpl?: typeof fetch; baseUrl?: string },
  ) {}

  async send(message: MailMessage) {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.opts.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MailerError(`Resend rejected the message (${res.status}): ${body.slice(0, 300)}`, res.status);
    }
  }
}

export interface MailerConfig {
  provider: "console" | "resend";
  from: string;
}

export function mailerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  const provider = (env.PLATFORM_EMAIL_PROVIDER ?? "console").trim().toLowerCase();
  if (provider !== "console" && provider !== "resend") throw new Error(`Unsupported PLATFORM_EMAIL_PROVIDER "${provider}" (expected console or resend)`);
  return { provider, from: env.PLATFORM_EMAIL_FROM?.trim() || "Steward <no-reply@localhost>" };
}

export function createMailer(log: pino.Logger, env: NodeJS.ProcessEnv = process.env): Mailer {
  const cfg = mailerConfigFromEnv(env);
  if (cfg.provider === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new Error("PLATFORM_EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    return new ResendMailer({ apiKey, from: cfg.from });
  }
  return new ConsoleMailer(log);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Minimal, client-safe HTML wrapper shared by all platform emails. */
export function renderEmail(opts: { title: string; intro: string; actionLabel: string; actionUrl: string; footer: string }): Pick<MailMessage, "text" | "html"> {
  const text = `${opts.title}\n\n${opts.intro}\n\n${opts.actionLabel}: ${opts.actionUrl}\n\n${opts.footer}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:16px;padding:32px;border:1px solid #e5e5ea">
<tr><td>
<p style="margin:0 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73">Steward</p>
<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-.01em">${escapeHtml(opts.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#3a3a3c">${escapeHtml(opts.intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(opts.actionUrl)}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:12px">${escapeHtml(opts.actionLabel)}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6e6e73">Or paste this link into your browser:<br><a href="${escapeHtml(opts.actionUrl)}" style="color:#0071e3;word-break:break-all">${escapeHtml(opts.actionUrl)}</a></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#6e6e73">${escapeHtml(opts.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}
