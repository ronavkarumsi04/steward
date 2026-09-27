import type { Hono } from "hono";
import { z } from "zod";
import { verifyStripeSignature, verifySvixSignature } from "@steward/integrations";
import { DEFAULT_SIGNAL_REVIEW_INSTRUCTION, SIGNAL_STATES, signalCandidate, type InboundSignal } from "@steward/core";
import type { TenantScope } from "@steward/schema";
import { HttpError, companyScope, param, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";
import { launcherFor, launchRun } from "./work.js";

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const firstText = (...values: unknown[]): string | undefined => values.map(text).find(Boolean);
const stringRecord = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
const money = (minor: number | undefined, currency: string | undefined) => minor === undefined ? undefined : new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "USD").toUpperCase() }).format(minor / 100);

function stripeMetadata(object: Record<string, unknown>) {
  const direct = stringRecord(object.metadata);
  const paymentIntent = stringRecord(record(object.payment_intent_data).metadata);
  const subscription = stringRecord(record(object.subscription_data).metadata);
  const parent = record(object.parent);
  const parentSub = stringRecord(record(record(parent.subscription_details).metadata));
  return { ...paymentIntent, ...subscription, ...parentSub, ...direct };
}

export function normalizeStripeSignal(payload: unknown): InboundSignal | null {
  const event = record(payload);
  const externalId = text(event.id);
  const eventType = text(event.type);
  if (!externalId || !eventType) return null;
  const object = record(record(event.data).object);
  const metadata = stripeMetadata(object);
  const currency = text(object.currency)?.toUpperCase();
  const customerDetails = record(object.customer_details);
  const customerEmail = firstText(customerDetails.email, object.customer_email, object.receipt_email);
  const customerId = firstText(object.customer, record(object.customer).id);
  const occurredAt = num(event.created) ? new Date(num(event.created)! * 1000) : new Date();
  const base = { integrationId: null, provider: "stripe", externalId, projectId: metadata.steward_project_id ?? null, customerRef: customerEmail ?? customerId ?? null, occurredAt } satisfies Partial<InboundSignal>;

  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(eventType)) {
    const amountMinor = num(object.amount_total);
    const amount = money(amountMinor, currency);
    return { ...base, kind: "payment.completed", title: "Payment completed", summary: `${amount ?? "A payment"} completed${customerEmail ? ` for ${customerEmail}` : ""}.`, severity: "positive", data: { eventType, checkoutSessionId: text(object.id), amountMinor, currency, paymentStatus: text(object.payment_status), mode: text(object.mode), customerEmail, customerId } } as InboundSignal;
  }
  if (eventType === "charge.refunded") {
    const amountMinor = num(object.amount_refunded) ?? num(object.amount);
    return { ...base, kind: "payment.refunded", title: "Payment refunded", summary: `${money(amountMinor, currency) ?? "A payment"} was refunded${customerEmail ? ` for ${customerEmail}` : ""}.`, severity: "warning", data: { eventType, chargeId: text(object.id), amountMinor, currency, customerEmail, customerId } } as InboundSignal;
  }
  if (["invoice.payment_failed", "payment_intent.payment_failed"].includes(eventType)) {
    const amountMinor = num(object.amount_due) ?? num(object.amount);
    return { ...base, kind: "payment.failed", title: "Payment failed", summary: `${money(amountMinor, currency) ?? "A payment"} failed${customerEmail ? ` for ${customerEmail}` : ""}.`, severity: "critical", data: { eventType, objectId: text(object.id), amountMinor, currency, customerEmail, customerId } } as InboundSignal;
  }
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(eventType)) {
    const status = text(object.status) ?? (eventType.endsWith("deleted") ? "cancelled" : "updated");
    return { ...base, kind: eventType.endsWith("deleted") ? "subscription.cancelled" : "subscription.updated", title: eventType.endsWith("deleted") ? "Subscription cancelled" : "Subscription changed", summary: `Subscription ${text(object.id) ?? ""} is ${status}.`.trim(), severity: eventType.endsWith("deleted") ? "warning" : "info", data: { eventType, subscriptionId: text(object.id), status, customerId } } as InboundSignal;
  }
  return null;
}

function resendTags(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return stringRecord(value);
  const tags: Record<string, string> = {};
  for (const item of value) {
    const r = record(item);
    const name = text(r.name);
    const val = text(r.value);
    if (name && val) tags[name] = val;
  }
  return tags;
}

export function normalizeResendSignal(payload: unknown, externalId: string): InboundSignal | null {
  const event = record(payload);
  const eventType = text(event.type);
  if (!eventType) return null;
  const data = record(event.data);
  const tags = resendTags(data.tags);
  const to = Array.isArray(data.to) ? data.to.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  const recipient = to[0];
  const subject = text(data.subject);
  const emailId = firstText(data.email_id, data.id);
  const from = text(data.from);
  const occurredAtText = firstText(event.created_at, data.created_at);
  const occurredAt = occurredAtText && !Number.isNaN(Date.parse(occurredAtText)) ? new Date(occurredAtText) : new Date();
  const base = { integrationId: null, provider: "resend", externalId, projectId: tags.steward_project_id ?? null, customerRef: recipient ?? from ?? null, occurredAt, data: { eventType, emailId, from, to, subject, campaignId: tags.campaign, stewardRunId: tags.steward_run_id, stewardTaskId: tags.steward_task_id } } satisfies Partial<InboundSignal>;
  const label = subject ? `“${subject}”` : "Email";
  const cases: Record<string, Pick<InboundSignal, "kind" | "title" | "summary" | "severity">> = {
    "email.delivered": { kind: "email.delivered", title: "Email delivered", summary: `${label}${recipient ? ` reached ${recipient}` : ""}.`, severity: "positive" },
    "email.bounced": { kind: "email.bounced", title: "Email bounced", summary: `${label}${recipient ? ` bounced for ${recipient}` : ""}.`, severity: "warning" },
    "email.complained": { kind: "email.complained", title: "Spam complaint", summary: `${label}${recipient ? ` was reported as spam by ${recipient}` : ""}.`, severity: "critical" },
    "email.delivery_delayed": { kind: "email.delayed", title: "Email delayed", summary: `${label}${recipient ? ` is delayed for ${recipient}` : ""}.`, severity: "warning" },
    "email.opened": { kind: "email.opened", title: "Email opened", summary: `${label}${recipient ? ` was opened by ${recipient}` : ""}.`, severity: "positive" },
    "email.clicked": { kind: "email.clicked", title: "Email link clicked", summary: `${label}${recipient ? ` got a click from ${recipient}` : ""}.`, severity: "positive" },
    "email.received": { kind: "email.received", title: "Inbound email received", summary: `${label}${from ? ` arrived from ${from}` : ""}.`, severity: "info" },
  };
  const normalized = cases[eventType];
  return normalized ? { ...base, ...normalized } as InboundSignal : null;
}

async function resolveSignalScope(deps: AppEnv["Variables"]["deps"], baseScope: TenantScope, signal: InboundSignal): Promise<TenantScope | null> {
  if (baseScope.companyId) return baseScope;
  if (signal.projectId) {
    const project = await deps.services.projects.findInOrganization(baseScope, signal.projectId);
    if (project) return { ...baseScope, companyId: project.companyId };
  }
  const activeCompanies = (await deps.services.companies.list(baseScope)).filter((company) => company.status === "active");
  return activeCompanies.length === 1 ? { ...baseScope, companyId: activeCompanies[0]!.id } : null;
}

type ReviewableSignal = { id: string; provider: string; kind: string; title: string; summary: string; severity: string; projectId: string | null; data: Record<string, unknown>; state: string; reviewRunId: string | null };

/**
 * The instruction a person asks for by hand. It shares the default rule's wording for what to do, but says
 * plainly that a person asked, because a run that claims "a rule you configured matched" when nobody's rule
 * did would be a lie in the record.
 */
function signalReviewInstruction(signal: ReviewableSignal) {
  return [
    `A verified ${signal.provider} business signal arrived: ${signal.title}.`,
    signal.summary,
    `Signal kind: ${signal.kind}. Severity: ${signal.severity}. Signal id: ${signal.id}.`,
    signal.projectId ? `This signal is linked to project ${signal.projectId}.` : "This signal is not linked to a project.",
    `Safe provider data: ${JSON.stringify(signal.data).slice(0, 4000)}`,
    DEFAULT_SIGNAL_REVIEW_INSTRUCTION,
    "External actions still require the normal policy and approval gates.",
  ].filter(Boolean).join("\n\n");
}

async function startSignalReview(deps: AppEnv["Variables"]["deps"], scope: TenantScope, signal: ReviewableSignal) {
  const operator = await deps.services.agents.byKind(scope, "orchestrator");
  if (!operator) throw new HttpError(404, "not_found", "Chief of Staff agent is unavailable");
  const run = await launchRun(deps.services, deps.workflows, scope, { agentId: operator.id, projectId: signal.projectId, instruction: signalReviewInstruction(signal), kind: "event", sourceSignalId: signal.id });
  const updated = await deps.services.signals.setState(scope, signal.id, "reviewing", run.id);
  return { signal: updated ?? signal, run };
}

export function registerSignalWebhookRoutes(app: Hono<AppEnv>) {
  app.post("/webhooks/:provider/:integrationId", async (c) => {
    const provider = c.req.param("provider").toLowerCase();
    if (provider !== "stripe" && provider !== "resend") throw new HttpError(404, "not_found", "Unsupported webhook provider");
    const integrationId = c.req.param("integrationId");
    const deps = c.get("deps");
    let resolved;
    try {
      resolved = await deps.services.integrations.resolveInboundWebhook(integrationId, provider);
    } catch {
      throw new HttpError(404, "not_found", "Webhook endpoint not found");
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, "utf8") > 1_000_000) throw new HttpError(400, "webhook_too_large", "Webhook body exceeds 1 MB");
    const stripeSignature = c.req.header("stripe-signature") ?? "";
    const svixId = c.req.header("svix-id") ?? "";
    const svixTimestamp = c.req.header("svix-timestamp") ?? "";
    const svixSignature = c.req.header("svix-signature") ?? "";
    const webhookSecret = resolved.secret.fields?.webhookSecret ?? "";
    const signatureValid = provider === "stripe"
      ? Boolean(webhookSecret && stripeSignature && verifyStripeSignature(webhookSecret, raw, stripeSignature))
      : Boolean(webhookSecret && svixId && svixTimestamp && svixSignature && verifySvixSignature(webhookSecret, raw, { id: svixId, timestamp: svixTimestamp, signature: svixSignature }));
    if (!signatureValid) throw new HttpError(401, "invalid_webhook_signature", `Invalid ${provider === "stripe" ? "Stripe" : "Resend"} webhook signature`);

    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new HttpError(400, "invalid_webhook", "Webhook body must be JSON"); }
    const externalId = provider === "stripe" ? text(record(payload).id) : svixId;
    if (!externalId) throw new HttpError(400, "invalid_webhook", "Webhook delivery id is missing");
    const normalized = provider === "stripe" ? normalizeStripeSignal(payload) : normalizeResendSignal(payload, externalId);
    const envelope = { provider, externalId, eventType: text(record(payload).type) ?? "unknown" };
    if (!normalized) {
      const fresh = await deps.services.integrations.recordInboundDelivery(provider, integrationId, externalId, envelope, resolved.scope.organizationId);
      return c.json({ ok: true, ignored: true, duplicate: !fresh });
    }
    const signalScope = await resolveSignalScope(deps, resolved.scope, normalized);
    if (!signalScope?.companyId) {
      const fresh = await deps.services.integrations.recordInboundDelivery(provider, integrationId, externalId, envelope, resolved.scope.organizationId);
      return c.json({ ok: true, ignored: true, duplicate: !fresh, reason: "ambiguous_company" });
    }
    const ingested = await deps.services.signals.ingest(signalScope, { ...normalized, integrationId });
    const fresh = await deps.services.integrations.recordInboundDelivery(provider, integrationId, externalId, envelope, resolved.scope.organizationId);
    // A fresh signal is offered to the company's reactions. Every rule that answers it is a row the founder
    // wrote and can pause; a signal no rule matches is inbox-only, which is what opens, clicks and deliveries
    // rely on. A reaction never breaks the webhook: the provider is told the signal was recorded.
    let autoReviewRunId: string | null = null;
    let decisions: Array<{ ruleId: string; status: string; code?: string; runId?: string | null }> = [];
    if (ingested.created) {
      try {
        const report = await deps.services.reactions.react(signalScope, signalCandidate(ingested.signal), { launcher: launcherFor(deps.workflows) });
        decisions = report.decisions.map((d) => ({ ruleId: d.ruleId, status: d.status, code: d.code, runId: d.runId ?? null }));
        autoReviewRunId = report.decisions.find((d) => d.runId && d.status !== "skipped")?.runId ?? null;
      } catch (err) {
        deps.core.log.warn({ err, signalId: ingested.signal.id, companyId: signalScope.companyId }, "reactions could not be offered this signal");
      }
    }
    return c.json({ ok: true, signalId: ingested.signal.id, created: ingested.created, duplicate: !fresh, autoReviewRunId, reactions: decisions });
  });
}

export function registerSignalRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/signals", tag: "signals", summary: "List verified business signals", query: z.object({ state: z.enum(SIGNAL_STATES).optional(), provider: z.string().max(40).optional(), projectId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ signals: await c.get("deps").services.signals.list(scope, query) });
  });

  /**
   * The Signals setting is the builtin review rule seen from the inbox, so reading it reads that rule. Before
   * the rule exists the answer is "off", which is the same answer the column gave when it was the source of
   * truth — but from here on one place decides what happens, and it is the place a founder can edit.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/signals/settings", tag: "signals", summary: "Read the builtin signal review rule the Signals toggle owns" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const company = await deps.services.companies.get(scope);
    if (!company) throw new HttpError(404, "not_found", "Company not found");
    const rule = await deps.services.reactions.signalReviewRule(scope);
    return c.json({ settings: { autoReviewImportant: rule?.enabled ?? false }, ruleId: rule?.id ?? null, canManage: scope.role === "owner" || scope.role === "admin" });
  });

  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/signals/settings", tag: "signals", summary: "Enable or disable automatic review of important verified signals", body: z.object({ autoReviewImportant: z.boolean() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const rule = await deps.services.reactions.setSignalReview(scope, body.autoReviewImportant);
    if (!rule) throw new HttpError(409, "no_orchestrator", "This company has no enabled Chief of Staff agent, so no rule can own the review");
    return c.json({ settings: { autoReviewImportant: rule.enabled }, ruleId: rule.id, canManage: true });
  });

  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/signals/:id", tag: "signals", summary: "Update Signal Inbox state", body: z.object({ state: z.enum(SIGNAL_STATES) }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const signal = await c.get("deps").services.signals.setState(scope, param(c, "id"), body.state);
    if (!signal) throw new HttpError(404, "not_found", "Signal not found");
    return c.json({ signal });
  });

  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/signals/:id/review", tag: "signals", summary: "Start a Chief of Staff event run to review a signal" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const signal = await deps.services.signals.get(scope, param(c, "id"));
    if (!signal) throw new HttpError(404, "not_found", "Signal not found");
    if (signal.state === "reviewing" && signal.reviewRunId) throw new HttpError(409, "signal_review_in_progress", "This signal is already being reviewed");
    const review = await startSignalReview(deps, scope, signal);
    return c.json(review, 201);
  });
}
