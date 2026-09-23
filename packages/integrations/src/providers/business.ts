import { apiJson, type IntegrationDefinition, type IntegrationSecret } from "../framework.js";

// ---------- Stripe ----------
export const stripeDefinition: IntegrationDefinition = {
  id: "stripe",
  name: "Stripe",
  category: "payments",
  authKind: "api_key",
  fields: [
    { key: "secretKey", label: "Restricted API key (read on charges/customers/subscriptions/balance; write on checkout/products if desired)", secret: true, placeholder: "rk_live_… / rk_test_…" },
    { key: "webhookSecret", label: "Webhook signing secret", secret: true, placeholder: "whsec_…" },
  ],
  docsUrl: "https://docs.stripe.com/api",
  actions: [
    { name: "read_metrics", description: "Read balance, charges, subscriptions", risk: "LOW", externallyVisible: false },
    { name: "create_product", description: "Create product/price", risk: "HIGH", dimension: "payments", externallyVisible: true },
    { name: "create_checkout_session", description: "Create a checkout link", risk: "HIGH", dimension: "payments", externallyVisible: true },
  ],
  webhook: { signatureHeader: "stripe-signature", scheme: "stripe" },
  status: "implemented",
};

export class StripeClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private req<T>(path: string, init: RequestInit & { form?: Record<string, string>; idempotencyKey?: string } = {}) {
    const headers: Record<string, string> = { authorization: `Bearer ${this.secret.fields?.secretKey ?? ""}`, "stripe-version": "2025-08-27.basil" };
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    let body: string | undefined;
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.form).toString();
    }
    return apiJson<T>("stripe", `https://api.stripe.com/v1${path}`, { method: init.method ?? (init.form ? "POST" : "GET"), headers, body });
  }
  balance() {
    return this.req<{ available: Array<{ amount: number; currency: string }>; pending: Array<{ amount: number; currency: string }> }>("/balance");
  }
  async revenueSummary(sinceUnix: number) {
    const charges = await this.req<{ data: Array<{ amount: number; currency: string; paid: boolean; refunded: boolean; created: number }> }>(`/charges?limit=100&created[gte]=${sinceUnix}`);
    const paid = charges.data.filter((c) => c.paid && !c.refunded);
    const byCurrency: Record<string, number> = {};
    for (const c of paid) byCurrency[c.currency] = (byCurrency[c.currency] ?? 0) + c.amount;
    const subs = await this.req<{ data: unknown[] }>("/subscriptions?status=active&limit=100");
    const customers = await this.req<{ data: unknown[] }>(`/customers?limit=100&created[gte]=${sinceUnix}`);
    return { chargesCount: paid.length, grossByCurrencyMinor: byCurrency, activeSubscriptions: subs.data.length, newCustomers: customers.data.length };
  }
  createProduct(input: { name: string; description?: string; unitAmountMinor: number; currency: string; interval?: "month" | "year" }, idempotencyKey: string) {
    const form: Record<string, string> = { name: input.name, "default_price_data[unit_amount]": String(input.unitAmountMinor), "default_price_data[currency]": input.currency };
    if (input.description) form.description = input.description;
    if (input.interval) form["default_price_data[recurring][interval]"] = input.interval;
    return this.req<{ id: string; default_price: string }>("/products", { form, idempotencyKey });
  }
  createCheckoutSession(input: { priceId: string; successUrl: string; cancelUrl: string; mode: "payment" | "subscription"; quantity?: number; metadata?: Record<string, string> }, idempotencyKey: string) {
    const form: Record<string, string> = { mode: input.mode, success_url: input.successUrl, cancel_url: input.cancelUrl, "line_items[0][price]": input.priceId, "line_items[0][quantity]": String(input.quantity ?? 1) };
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      form[`metadata[${key}]`] = value;
      form[`${input.mode === "subscription" ? "subscription_data" : "payment_intent_data"}[metadata][${key}]`] = value;
    }
    return this.req<{ id: string; url: string }>("/checkout/sessions", { form, idempotencyKey });
  }
  async verify() {
    const acct = await this.req<{ id: string; business_profile?: { name?: string }; livemode?: boolean }>("/account");
    return { id: acct.id, name: acct.business_profile?.name, livemode: acct.livemode };
  }
}

// ---------- Neon (Postgres provisioning) ----------
export const neonDefinition: IntegrationDefinition = {
  id: "neon",
  name: "Neon Postgres",
  category: "database",
  authKind: "api_key",
  fields: [{ key: "apiKey", label: "Neon API key", secret: true }, { key: "orgId", label: "Organization ID (optional)", secret: false, placeholder: "org-…" }],
  docsUrl: "https://api-docs.neon.tech/reference/getting-started-with-neon-api",
  actions: [
    { name: "list_projects", description: "List projects", risk: "LOW", externallyVisible: false },
    { name: "create_project", description: "Create a Postgres project (may incur cost)", risk: "MEDIUM", dimension: "infra_spend", externallyVisible: false },
  ],
  status: "implemented",
};

export class NeonClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private req<T>(path: string, init: RequestInit = {}) {
    return apiJson<T>("neon", `https://console.neon.tech/api/v2${path}`, { ...init, headers: { authorization: `Bearer ${this.secret.fields?.apiKey ?? ""}`, ...(init.headers as Record<string, string> | undefined) } });
  }
  async listProjects() {
    const j = await this.req<{ projects: Array<{ id: string; name: string; region_id: string; created_at: string }> }>(`/projects?limit=100${this.secret.fields?.orgId ? `&org_id=${this.secret.fields.orgId}` : ""}`);
    return j.projects;
  }
  async createProject(input: { name: string; region?: string; pgVersion?: number }) {
    const j = await this.req<{ project: { id: string; name: string }; connection_uris: Array<{ connection_uri: string }> }>("/projects", { method: "POST", body: JSON.stringify({ project: { name: input.name, region_id: input.region ?? "aws-us-east-2", pg_version: input.pgVersion ?? 17, org_id: this.secret.fields?.orgId || undefined } }) });
    return { id: j.project.id, name: j.project.name, connectionUri: j.connection_uris[0]?.connection_uri };
  }
  async deleteProject(id: string) {
    await this.req(`/projects/${id}`, { method: "DELETE" });
  }
}

// ---------- Supabase ----------
export const supabaseDefinition: IntegrationDefinition = {
  id: "supabase",
  name: "Supabase",
  category: "database",
  authKind: "token",
  fields: [{ key: "accessToken", label: "Personal access token", secret: true, placeholder: "sbp_…" }],
  docsUrl: "https://supabase.com/docs/reference/api/introduction",
  actions: [
    { name: "list_projects", description: "List projects", risk: "LOW", externallyVisible: false },
    { name: "create_project", description: "Create a project (cost)", risk: "HIGH", dimension: "infra_spend", externallyVisible: false },
  ],
  status: "framework",
};

export class SupabaseClient {
  constructor(private readonly secret: IntegrationSecret) {}
  listProjects() {
    return apiJson<Array<{ id: string; name: string; region: string; status: string }>>("supabase", "https://api.supabase.com/v1/projects", { headers: { authorization: `Bearer ${this.secret.fields?.accessToken ?? ""}` } });
  }
  listOrganizations() {
    return apiJson<Array<{ id: string; name: string }>>("supabase", "https://api.supabase.com/v1/organizations", { headers: { authorization: `Bearer ${this.secret.fields?.accessToken ?? ""}` } });
  }
}

// ---------- HubSpot ----------
export const hubspotDefinition: IntegrationDefinition = {
  id: "hubspot",
  name: "HubSpot",
  category: "crm",
  authKind: "oauth2",
  oauth: { authorizeUrl: "https://app.hubspot.com/oauth/authorize", tokenUrl: "https://api.hubapi.com/oauth/v1/token", scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read", "crm.objects.deals.write", "oauth"], pkce: false, clientAuth: "body" },
  fields: [{ key: "privateAppToken", label: "Private app token (alternative to OAuth)", secret: true, placeholder: "pat-…" }],
  docsUrl: "https://developers.hubspot.com/docs/api/crm/contacts",
  actions: [
    { name: "search_contacts", description: "Search contacts", risk: "LOW", externallyVisible: false },
    { name: "upsert_contact", description: "Create/update contact", risk: "HIGH", dimension: "external_write", externallyVisible: false },
  ],
  webhook: { signatureHeader: "x-hubspot-signature-v3", scheme: "hmac_sha256_base64" },
  status: "framework",
};

export class HubSpotClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private headers() {
    return { authorization: `Bearer ${this.secret.accessToken ?? this.secret.fields?.privateAppToken ?? ""}` };
  }
  searchContacts(query: string) {
    return apiJson<{ results: Array<{ id: string; properties: Record<string, string> }> }>("hubspot", "https://api.hubapi.com/crm/v3/objects/contacts/search", { method: "POST", headers: this.headers(), body: JSON.stringify({ query, limit: 20, properties: ["email", "firstname", "lastname", "company", "lifecyclestage"] }) });
  }
  createContact(props: Record<string, string>) {
    return apiJson<{ id: string }>("hubspot", "https://api.hubapi.com/crm/v3/objects/contacts", { method: "POST", headers: this.headers(), body: JSON.stringify({ properties: props }) });
  }
}

// ---------- Notion ----------
export const notionDefinition: IntegrationDefinition = {
  id: "notion",
  name: "Notion",
  category: "docs",
  authKind: "token",
  fields: [{ key: "token", label: "Internal integration secret", secret: true, placeholder: "ntn_…" }],
  docsUrl: "https://developers.notion.com/reference/intro",
  actions: [
    { name: "search", description: "Search pages", risk: "LOW", externallyVisible: false },
    { name: "create_page", description: "Create a page", risk: "MEDIUM", dimension: "external_write", externallyVisible: false },
  ],
  status: "framework",
};

export class NotionClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private headers() {
    return { authorization: `Bearer ${this.secret.fields?.token ?? this.secret.accessToken ?? ""}`, "notion-version": "2022-06-28" };
  }
  search(query: string) {
    return apiJson<{ results: Array<{ id: string; object: string; url: string }> }>("notion", "https://api.notion.com/v1/search", { method: "POST", headers: this.headers(), body: JSON.stringify({ query, page_size: 20 }) });
  }
  createPage(parentPageId: string, title: string, markdown: string) {
    const paragraphs = markdown.split(/\n{2,}/).slice(0, 90).map((t) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: t.slice(0, 1900) } }] } }));
    return apiJson<{ id: string; url: string }>("notion", "https://api.notion.com/v1/pages", { method: "POST", headers: this.headers(), body: JSON.stringify({ parent: { page_id: parentPageId }, properties: { title: [{ type: "text", text: { content: title } }] }, children: paragraphs }) });
  }
}

// ---------- Google (identity + Gmail + Calendar) ----------
export const googleDefinition: IntegrationDefinition = {
  id: "google",
  name: "Google Workspace (Gmail, Calendar)",
  category: "email",
  authKind: "oauth2",
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events"],
    pkce: true,
    clientAuth: "body",
    authorizeParams: { access_type: "offline", prompt: "consent" },
    revokeUrl: "https://oauth2.googleapis.com/revoke",
  },
  docsUrl: "https://developers.google.com/gmail/api/reference/rest",
  actions: [
    { name: "list_messages", description: "List/read inbox messages", risk: "LOW", externallyVisible: false },
    { name: "send_email", description: "Send email from the connected account", risk: "HIGH", dimension: "email_send", externallyVisible: true },
    { name: "create_event", description: "Create calendar event", risk: "MEDIUM", dimension: "external_write", externallyVisible: true },
  ],
  status: "implemented",
};

export class GoogleClient {
  constructor(private readonly secret: IntegrationSecret) {}
  private headers() {
    return { authorization: `Bearer ${this.secret.accessToken ?? ""}` };
  }
  userinfo() {
    return apiJson<{ sub: string; email: string; name?: string }>("google", "https://openidconnect.googleapis.com/v1/userinfo", { headers: this.headers() });
  }
  async listMessages(q = "newer_than:7d", max = 20) {
    const list = await apiJson<{ messages?: Array<{ id: string }> }>("google", `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`, { headers: this.headers() });
    const out = [];
    for (const m of list.messages ?? []) {
      const msg = await apiJson<{ id: string; snippet: string; payload: { headers: Array<{ name: string; value: string }> } }>("google", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: this.headers() });
      const h = (n: string) => msg.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      out.push({ id: msg.id, from: h("from"), subject: h("subject"), date: h("date"), snippet: msg.snippet });
    }
    return out;
  }
  async sendEmail(input: { to: string[]; subject: string; text: string; from?: string }) {
    const raw = [`To: ${input.to.join(", ")}`, input.from ? `From: ${input.from}` : "", `Subject: ${input.subject}`, "Content-Type: text/plain; charset=utf-8", "", input.text].filter((l, i) => l !== "" || i >= 4).join("\r\n");
    const r = await apiJson<{ id: string; threadId: string }>("google", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: this.headers(), body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }) });
    return { id: r.id };
  }
  createEvent(input: { summary: string; description?: string; start: string; end: string; attendees?: string[]; timezone?: string }) {
    return apiJson<{ id: string; htmlLink: string }>("google", "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", { method: "POST", headers: this.headers(), body: JSON.stringify({ summary: input.summary, description: input.description, start: { dateTime: input.start, timeZone: input.timezone }, end: { dateTime: input.end, timeZone: input.timezone }, attendees: input.attendees?.map((email) => ({ email })) }) });
  }
}

// ---------- Generic REST connector ----------
export const genericRestDefinition: IntegrationDefinition = {
  id: "generic_rest",
  name: "Generic REST API",
  category: "generic",
  authKind: "api_key",
  fields: [
    { key: "baseUrl", label: "Base URL", secret: false, placeholder: "https://api.example.com" },
    { key: "authHeader", label: "Auth header name", secret: false, placeholder: "Authorization" },
    { key: "authValue", label: "Auth header value", secret: true, placeholder: "Bearer …" },
    { key: "allowedMethods", label: "Allowed methods (comma separated)", secret: false, placeholder: "GET,POST" },
  ],
  docsUrl: "https://github.com/steward-os/steward/blob/main/docs/INTEGRATIONS.md#generic-rest",
  actions: [
    { name: "request_read", description: "GET request", risk: "LOW", externallyVisible: false },
    { name: "request_write", description: "Mutating request", risk: "HIGH", dimension: "external_write", externallyVisible: true },
  ],
  status: "implemented",
};
