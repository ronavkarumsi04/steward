import { apiJson, type IntegrationDefinition, type IntegrationSecret } from "../framework.js";

export const slackDefinition: IntegrationDefinition = {
  id: "slack",
  name: "Slack",
  category: "messaging",
  authKind: "oauth2",
  oauth: { authorizeUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access", scopes: ["chat:write", "channels:read", "chat:write.public"], pkce: false, clientAuth: "body" },
  fields: [
    { key: "botToken", label: "Bot token (xoxb-…) if not using OAuth", secret: true },
    { key: "webhookUrl", label: "Incoming webhook URL (alternative)", secret: true, placeholder: "https://hooks.slack.com/services/…" },
    { key: "signingSecret", label: "Signing secret (for inbound events)", secret: true },
  ],
  docsUrl: "https://api.slack.com/web",
  actions: [
    { name: "post_message", description: "Post a message to a channel", risk: "MEDIUM", dimension: "customer_comms", externallyVisible: true },
    { name: "list_channels", description: "List channels", risk: "LOW", externallyVisible: false },
  ],
  webhook: { signatureHeader: "x-slack-signature", scheme: "slack" },
  status: "implemented",
};

export class SlackClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private get token() {
    return this.secret.accessToken ?? this.secret.fields?.botToken ?? "";
  }
  private async call<T>(method: string, body?: Record<string, unknown>) {
    const r = await apiJson<{ ok: boolean; error?: string } & T>("slack", `https://slack.com/api/${method}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json; charset=utf-8" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`slack ${method}: ${r.error}`);
    return r;
  }
  async postMessage(input: { channel: string; text: string; blocks?: unknown[]; threadTs?: string }) {
    if (!this.token && this.secret.fields?.webhookUrl) {
      const res = await fetch(this.secret.fields.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: input.text, blocks: input.blocks }) });
      if (!res.ok) throw new Error(`slack webhook HTTP ${res.status}`);
      return { ts: String(Date.now()), channel: input.channel || "webhook" };
    }
    const r = await this.call<{ ts: string; channel: string }>("chat.postMessage", { channel: input.channel, text: input.text, blocks: input.blocks, thread_ts: input.threadTs });
    return { ts: r.ts, channel: r.channel };
  }
  async listChannels() {
    const r = await this.call<{ channels: Array<{ id: string; name: string; is_member: boolean }> }>("conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true");
    return r.channels.map((c) => ({ id: c.id, name: c.name, member: c.is_member }));
  }
  async authTest() {
    return this.call<{ team: string; user: string; bot_id?: string }>("auth.test");
  }
}

export const discordDefinition: IntegrationDefinition = {
  id: "discord",
  name: "Discord",
  category: "messaging",
  authKind: "webhook_url",
  fields: [{ key: "webhookUrl", label: "Channel webhook URL", secret: true, placeholder: "https://discord.com/api/webhooks/…" }],
  docsUrl: "https://discord.com/developers/docs/resources/webhook",
  actions: [{ name: "post_message", description: "Post a message via webhook", risk: "MEDIUM", dimension: "customer_comms", externallyVisible: true }],
  webhook: { signatureHeader: "x-signature-ed25519", scheme: "ed25519" },
  status: "implemented",
};

export class DiscordWebhookClient {
  constructor(private readonly secret: IntegrationSecret) {}
  async post(input: { content: string; username?: string; embeds?: unknown[] }) {
    const url = this.secret.fields?.webhookUrl ?? "";
    if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) throw new Error("Invalid Discord webhook URL");
    const res = await fetch(`${url}?wait=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`discord HTTP ${res.status}`);
    const j = (await res.json()) as { id: string };
    return { id: j.id };
  }
}

export const twilioDefinition: IntegrationDefinition = {
  id: "twilio",
  name: "Twilio SMS",
  category: "messaging",
  authKind: "basic",
  fields: [
    { key: "accountSid", label: "Account SID", secret: false, placeholder: "AC…" },
    { key: "authToken", label: "Auth token (or API key secret)", secret: true },
    { key: "apiKeySid", label: "API key SID (optional, preferred over auth token)", secret: false, placeholder: "SK…" },
    { key: "from", label: "From number / messaging service SID", secret: false, placeholder: "+1555… or MG…" },
  ],
  docsUrl: "https://www.twilio.com/docs/messaging/api/message-resource",
  actions: [{ name: "send_sms", description: "Send an SMS", risk: "HIGH", dimension: "customer_comms", externallyVisible: true }],
  webhook: { signatureHeader: "x-twilio-signature", scheme: "twilio" },
  status: "implemented",
};

export class TwilioClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private auth() {
    const f = this.secret.fields ?? {};
    const user = f.apiKeySid || f.accountSid || "";
    return `Basic ${Buffer.from(`${user}:${f.authToken ?? ""}`).toString("base64")}`;
  }
  async sendSms(input: { to: string; body: string }) {
    const f = this.secret.fields ?? {};
    const from = f.from ?? "";
    const params = new URLSearchParams({ To: input.to, Body: input.body, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
    const r = await apiJson<{ sid: string; status: string }>("twilio", `https://api.twilio.com/2010-04-01/Accounts/${f.accountSid}/Messages.json`, { method: "POST", headers: { authorization: this.auth(), "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
    return { id: r.sid, status: r.status };
  }
  async verify() {
    const f = this.secret.fields ?? {};
    return apiJson<{ friendly_name: string; status: string }>("twilio", `https://api.twilio.com/2010-04-01/Accounts/${f.accountSid}.json`, { headers: { authorization: this.auth() } });
  }
}

export const xDefinition: IntegrationDefinition = {
  id: "x",
  name: "X (Twitter)",
  category: "social",
  authKind: "oauth2",
  oauth: { authorizeUrl: "https://twitter.com/i/oauth2/authorize", tokenUrl: "https://api.twitter.com/2/oauth2/token", scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"], pkce: true, clientAuth: "basic" },
  docsUrl: "https://developer.x.com/en/docs/x-api",
  actions: [
    { name: "publish_post", description: "Publish a post", risk: "HIGH", dimension: "social_publish", externallyVisible: true },
    { name: "me", description: "Read authenticated account", risk: "LOW", externallyVisible: false },
  ],
  status: "implemented",
};

export class XClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private headers() {
    return { authorization: `Bearer ${this.secret.accessToken ?? ""}` };
  }
  me() {
    return apiJson<{ data: { id: string; username: string; name: string } }>("x", "https://api.twitter.com/2/users/me", { headers: this.headers() });
  }
  async publish(input: { text: string; replyToId?: string }) {
    const r = await apiJson<{ data: { id: string; text: string } }>("x", "https://api.twitter.com/2/tweets", { method: "POST", headers: this.headers(), body: JSON.stringify({ text: input.text, ...(input.replyToId ? { reply: { in_reply_to_tweet_id: input.replyToId } } : {}) }) });
    return { id: r.data.id, url: `https://x.com/i/status/${r.data.id}` };
  }
}

export const linkedinDefinition: IntegrationDefinition = {
  id: "linkedin",
  name: "LinkedIn",
  category: "social",
  authKind: "oauth2",
  oauth: { authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization", tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken", scopes: ["openid", "profile", "w_member_social"], pkce: false, clientAuth: "body" },
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin",
  actions: [{ name: "publish_post", description: "Publish a member post", risk: "HIGH", dimension: "social_publish", externallyVisible: true }],
  status: "framework",
};

export class LinkedInClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private headers() {
    return { authorization: `Bearer ${this.secret.accessToken ?? ""}`, "linkedin-version": "202409", "x-restli-protocol-version": "2.0.0" };
  }
  async me() {
    return apiJson<{ sub: string; name: string }>("linkedin", "https://api.linkedin.com/v2/userinfo", { headers: this.headers() });
  }
  async publish(input: { text: string }) {
    const me = await this.me();
    const res = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers: { ...this.headers(), "content-type": "application/json" }, body: JSON.stringify({ author: `urn:li:person:${me.sub}`, commentary: input.text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }) });
    if (!res.ok) throw new Error(`linkedin HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { id: res.headers.get("x-restli-id") ?? "" };
  }
}
