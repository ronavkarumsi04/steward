import nodemailer from "nodemailer";
import { apiJson, type IntegrationDefinition, type IntegrationSecret } from "../framework.js";

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Provider idempotency key where supported. */
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

export interface EmailProvider {
  id: string;
  send(msg: EmailMessage): Promise<{ id: string; provider: string }>;
  verify(): Promise<{ ok: boolean; detail?: string }>;
}

const emailActions: IntegrationDefinition["actions"] = [
  { name: "send_email", description: "Send an email", risk: "HIGH", dimension: "email_send", externallyVisible: true },
  { name: "verify", description: "Verify credentials", risk: "LOW", externallyVisible: false },
];

export const resendDefinition: IntegrationDefinition = {
  id: "resend",
  name: "Resend",
  category: "email",
  authKind: "api_key",
  fields: [{ key: "apiKey", label: "Resend API key (sending access, domain-scoped)", secret: true, placeholder: "re_…" }, { key: "webhookSecret", label: "Webhook signing secret (optional)", secret: true, placeholder: "whsec_…" }],
  docsUrl: "https://resend.com/docs/api-reference",
  actions: emailActions,
  webhook: { signatureHeader: "svix-signature", scheme: "svix" },
  status: "implemented",
};

export class ResendProvider implements EmailProvider {
  readonly id = "resend";
  constructor(private readonly secret: IntegrationSecret) {}
  private get key() {
    return this.secret.fields?.apiKey ?? "";
  }
  async send(msg: EmailMessage) {
    const r = await apiJson<{ id: string }>("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}`, ...(msg.idempotencyKey ? { "idempotency-key": msg.idempotencyKey } : {}) },
      body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo, headers: msg.headers, tags: msg.tags ? Object.entries(msg.tags).map(([name, value]) => ({ name, value })) : undefined }),
    });
    return { id: r.id, provider: this.id };
  }
  async verify() {
    try {
      const r = await apiJson<{ data: Array<{ name: string; status: string }> }>("resend", "https://api.resend.com/domains", { headers: { authorization: `Bearer ${this.key}` } });
      return { ok: true, detail: `${r.data.length} domain(s): ${r.data.map((d) => `${d.name} (${d.status})`).join(", ") || "none verified yet"}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

export const postmarkDefinition: IntegrationDefinition = {
  id: "postmark",
  name: "Postmark",
  category: "email",
  authKind: "api_key",
  fields: [{ key: "serverToken", label: "Server API token (send-only; never the account token)", secret: true }, { key: "messageStream", label: "Message stream", secret: false, placeholder: "outbound" }],
  docsUrl: "https://postmarkapp.com/developer/api/email-api",
  actions: emailActions,
  webhook: { signatureHeader: "authorization", scheme: "token" },
  status: "implemented",
};

export class PostmarkProvider implements EmailProvider {
  readonly id = "postmark";
  constructor(private readonly secret: IntegrationSecret) {}
  async send(msg: EmailMessage) {
    const r = await apiJson<{ MessageID: string }>("postmark", "https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "x-postmark-server-token": this.secret.fields?.serverToken ?? "" },
      body: JSON.stringify({ From: msg.from, To: msg.to.join(","), Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html, ReplyTo: msg.replyTo, MessageStream: this.secret.fields?.messageStream || "outbound", Headers: msg.headers ? Object.entries(msg.headers).map(([Name, Value]) => ({ Name, Value })) : undefined, Tag: msg.tags?.campaign }),
    });
    return { id: r.MessageID, provider: this.id };
  }
  async verify() {
    try {
      const r = await apiJson<{ Name: string }>("postmark", "https://api.postmarkapp.com/server", { headers: { "x-postmark-server-token": this.secret.fields?.serverToken ?? "" } });
      return { ok: true, detail: `Server: ${r.Name}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

export const sendgridDefinition: IntegrationDefinition = {
  id: "sendgrid",
  name: "SendGrid",
  category: "email",
  authKind: "api_key",
  fields: [{ key: "apiKey", label: "API key (restricted: Mail Send only)", secret: true, placeholder: "SG.…" }],
  docsUrl: "https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send",
  actions: emailActions,
  webhook: { signatureHeader: "x-twilio-email-event-webhook-signature", scheme: "ed25519" },
  status: "implemented",
};

export class SendGridProvider implements EmailProvider {
  readonly id = "sendgrid";
  constructor(private readonly secret: IntegrationSecret) {}
  async send(msg: EmailMessage) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${this.secret.fields?.apiKey ?? ""}`, "content-type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: msg.to.map((email) => ({ email })) }], from: { email: msg.from }, reply_to: msg.replyTo ? { email: msg.replyTo } : undefined, subject: msg.subject, content: [msg.text ? { type: "text/plain", value: msg.text } : null, msg.html ? { type: "text/html", value: msg.html } : null].filter(Boolean), headers: msg.headers, custom_args: msg.tags }),
    });
    if (!res.ok) throw new Error(`sendgrid HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { id: res.headers.get("x-message-id") ?? `sg_${Date.now()}`, provider: this.id };
  }
  async verify() {
    try {
      await apiJson("sendgrid", "https://api.sendgrid.com/v3/scopes", { headers: { authorization: `Bearer ${this.secret.fields?.apiKey ?? ""}` } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

export const smtpDefinition: IntegrationDefinition = {
  id: "smtp",
  name: "SMTP",
  category: "email",
  authKind: "smtp",
  fields: [
    { key: "host", label: "SMTP host", secret: false },
    { key: "port", label: "Port", secret: false, placeholder: "587" },
    { key: "user", label: "Username", secret: false },
    { key: "password", label: "Password", secret: true },
    { key: "secure", label: "Implicit TLS (true for port 465)", secret: false, placeholder: "false" },
    // The sending tool reads a from address off the integration before falling back to the deployment's
    // platform sender, so an SMTP connection has to be able to store one: without it, a connected server can
    // be reached and still refuse every send for want of a sender.
    { key: "fromAddress", label: "From address", secret: false, placeholder: "Steward <hi@yourdomain.com>" },
  ],
  docsUrl: "https://nodemailer.com/smtp/",
  actions: emailActions,
  status: "implemented",
};

export class SmtpProvider implements EmailProvider {
  readonly id = "smtp";
  private readonly transport;
  constructor(secret: IntegrationSecret) {
    const f = secret.fields ?? {};
    this.transport = nodemailer.createTransport({ host: f.host, port: Number(f.port ?? 587), secure: f.secure === "true", auth: f.user ? { user: f.user, pass: f.password } : undefined });
  }
  async send(msg: EmailMessage) {
    const info = await this.transport.sendMail({ from: msg.from, to: msg.to.join(", "), subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo, headers: msg.headers });
    return { id: info.messageId, provider: this.id };
  }
  async verify() {
    try {
      await this.transport.verify();
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function emailProviderFor(id: string, secret: IntegrationSecret): EmailProvider {
  switch (id) {
    case "resend":
      return new ResendProvider(secret);
    case "postmark":
      return new PostmarkProvider(secret);
    case "sendgrid":
      return new SendGridProvider(secret);
    case "smtp":
      return new SmtpProvider(secret);
    default:
      throw new Error(`Unknown email provider ${id}`);
  }
}
