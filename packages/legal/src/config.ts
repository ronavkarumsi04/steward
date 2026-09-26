/**
 * Facts that decide what the public legal documents are allowed to claim.
 *
 * Every value here is either (a) verified against this repository, or (b) supplied by the
 * operator through the environment. Nothing is invented: when an operator-specific fact is
 * unknown, the rendered document shows an explicit "needs configuration" marker instead of a
 * plausible-looking guess.
 */

export interface LegalConfig {
  /** Public product name. */
  serviceName: string;
  /** How we describe who operates the hosted service, in a "between you and X" construction. */
  operator: string;
  /** The same party as a plain noun phrase, for use mid-sentence. */
  operatorName: string;
  /** Set when a registered company actually operates the service; null means "no entity claimed". */
  legalEntityName: string | null;
  /** Postal address used for legal notices and CAN-SPAM, when one exists. */
  legalEntityAddress: string | null;
  /** Contact mailbox for privacy/legal requests. Null falls back to the repository channel. */
  contactEmail: string | null;
  /** Public contact channel that always exists for an open-source project. */
  repositoryUrl: string;
  /** Region where the operator's production data is hosted, as disclosed in the privacy policy. */
  hostingRegion: string;
  governingLaw: string;
  venue: string;
  /** Minimum age required to hold an account. */
  minimumAge: number;
  /** True only when the operator charges for the hosted service. */
  billingEnabled: boolean;
  /** Whether the operator takes EU/EEA data subjects, which triggers the SCC-based transfer terms. */
  internationalTransfers: boolean;
  effectiveDate: string;
}

const DEFAULT_REPOSITORY = "https://github.com/ronavkarumsi04/steward";

function readEnv(source: NodeJS.ProcessEnv) {
  return {
    email: source.LEGAL_CONTACT_EMAIL?.trim() || null,
    entity: source.LEGAL_ENTITY_NAME?.trim() || null,
    address: source.LEGAL_ENTITY_ADDRESS?.trim() || null,
    law: source.LEGAL_GOVERNING_LAW?.trim(),
    venue: source.LEGAL_VENUE?.trim(),
    region: source.LEGAL_HOSTING_REGION?.trim(),
    repo: source.LEGAL_REPOSITORY_URL?.trim() || DEFAULT_REPOSITORY,
    billing: source.LEGAL_BILLING_ENABLED?.trim().toLowerCase() === "true",
    transfers: (source.LEGAL_INTERNATIONAL_TRANSFERS ?? "true").trim().toLowerCase() !== "false",
  };
}

export function legalConfigFromEnv(processEnv: NodeJS.ProcessEnv = process.env): LegalConfig {
  const e = readEnv(processEnv);
  return {
    serviceName: "Steward",
    // No incorporated entity exists today; the documents say exactly that rather than implying one.
    operator: e.entity
      ? `${e.entity}, which operates the hosted Steward service`
      : "the Steward open-source project maintainers, who operate the hosted Steward service as a non-commercial open-source offering",
    operatorName: e.entity ?? "the Steward open-source project maintainers",
    legalEntityName: e.entity,
    legalEntityAddress: e.address,
    contactEmail: e.email,
    repositoryUrl: e.repo,
    hostingRegion: e.region || "the region configured by the operator of this deployment",
    governingLaw: e.law || "the laws of the State of Delaware, United States",
    venue: e.venue || "the state and federal courts located in Delaware, United States",
    minimumAge: 18,
    billingEnabled: e.billing,
    internationalTransfers: e.transfers,
    effectiveDate: "2026-09-25",
  };
}

/** The mailbox/channel requests should use, rendered in documents. */
export function legalContact(cfg: LegalConfig): string {
  return cfg.contactEmail ?? `${cfg.repositoryUrl} (the contact channel published in the repository profile)`;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionRule {
  id: string;
  /** Data category in plain language. */
  data: string;
  /** Where it lives, so the policy can be checked against the schema. */
  storage: string;
  /** Why we keep it. */
  purpose: string;
  /** How long, as a human-readable window that the sweep job actually enforces. */
  retention: string;
  /** Machine window in days for rules the sweeper enforces; null when retention is event-based. */
  sweepDays: number | null;
  /** What deletion means for this category. */
  onDeletion: string;
}

/**
 * Single source of truth shared by the public Retention Policy page and the worker's
 * retention sweep. If a window is enforced in code it must be the same number here.
 */
export const RETENTION_POLICY: RetentionRule[] = [
  {
    id: "sessions",
    data: "Sign-in sessions (token hash, last-seen time, IP address, user agent)",
    storage: "sessions table",
    purpose: "Keep you signed in and let you revoke access to a device.",
    retention: "14 days after the session is created or last refreshed; deleted as soon as it expires.",
    sweepDays: 14,
    onDeletion: "All of your sessions are revoked immediately.",
  },
  {
    id: "auth_tokens",
    data: "One-time email tokens (password reset, email verification)",
    storage: "email_verifications table",
    purpose: "Let you reset a password or verify an address once.",
    retention: "30 minutes for password resets; deleted once used or expired.",
    sweepDays: 1,
    onDeletion: "Deleted with the account.",
  },
  {
    id: "invitations",
    data: "Pending organization invitations (email address, role, token hash)",
    storage: "invitations table",
    purpose: "Let an invited teammate join your organization.",
    retention: "7 days, or until accepted or revoked.",
    sweepDays: 7,
    onDeletion: "Pending invitations you issued are revoked; accepted invitations are deleted with the organization.",
  },
  {
    id: "activity_events",
    data: "Operational activity events shown in the live feed",
    storage: "events table",
    purpose: "Show what happened in a company and drive the live activity stream.",
    retention: "90 days.",
    sweepDays: 90,
    onDeletion: "Deleted immediately, except records needed to honor an opt-out or to resolve a dispute.",
  },
  {
    id: "webhook_deliveries",
    data: "Recorded attempts to deliver your webhooks, including response codes",
    storage: "webhook_deliveries table",
    purpose: "Let you debug a failing integration endpoint.",
    retention: "30 days.",
    sweepDays: 30,
    onDeletion: "Deleted immediately.",
  },
  {
    id: "run_history",
    data: "Agent runs and their steps — plan, model choice, tool calls, decisions, cost",
    storage: "agent_runs, agent_run_steps, ai_calls, tool_calls, decisions, approvals, budgets, budget_ledger",
    purpose: "This is the product's audit trail: showing what an agent did, under which authorization, and what it cost.",
    retention: "For the life of the company so the audit trail stays intact.",
    sweepDays: null,
    onDeletion: "Deleted when the company or account is deleted.",
  },
  {
    id: "conversations",
    data: "Chat conversations and messages",
    storage: "conversations, messages",
    purpose: "Provide the assistant experience and preserve context you asked the agents to keep.",
    retention: "For the life of the company; you can delete individual conversations at any time.",
    sweepDays: null,
    onDeletion: "Deleted when the company or account is deleted.",
  },
  {
    id: "memories",
    data: "Long-term memories and their vector embeddings",
    storage: "memories (pgvector embeddings)",
    purpose: "Recall facts about your business without you repeating them.",
    retention: "For the life of the company; individual memories can be deleted or superseded at any time.",
    sweepDays: null,
    onDeletion: "Embeddings and text deleted when the company or account is deleted.",
  },
  {
    id: "artifacts",
    data: "Files and generated artifacts agents produce",
    storage: "artifacts table plus the operator's artifact storage directory",
    purpose: "Deliver the work product the agents created for you.",
    retention: "Until you delete the artifact, the company, or the account.",
    sweepDays: null,
    onDeletion: "File bytes and metadata are deleted from storage; copies in backups expire within 30 days.",
  },
  {
    id: "outbound_messages",
    data: "Outbound email, SMS and social messages your agents sent, with the recipient and body",
    storage: "outbound_messages, contacts, leads, campaigns",
    purpose: "Deliver the message, prevent duplicate sends, and keep evidence of what was sent on your behalf.",
    retention: "For the life of the company.",
    sweepDays: null,
    onDeletion: "Deleted with the company, except suppression records described below.",
  },
  {
    id: "suppression",
    data: "Opt-out and suppression records (email address or phone number plus the reason)",
    storage: "suppression_list, contacts.opted_out_at",
    purpose: "Honor a recipient's request not to be contacted again. This is the one category we keep after deletion.",
    retention: "Retained after account deletion, limited to the contact address and the opt-out reason, and used only to avoid re-contacting that person.",
    sweepDays: null,
    onDeletion: "Kept in minimized form to honor the opt-out; never used for any other purpose.",
  },
  {
    id: "credentials",
    data: "Your model-provider keys (BYOK) and integration/OAuth credentials",
    storage: "provider_credentials, integration_credentials, oauth_states, oauth_identities, api_keys",
    purpose: "Call the model and service providers you connected, on your behalf.",
    retention: "Until you delete the credential, disconnect the integration, or delete the account.",
    sweepDays: null,
    onDeletion: "Encrypted values are deleted; OAuth grants are revoked where the provider supports revocation.",
  },
  {
    id: "audit_log",
    data: "Security-relevant audit entries (actor, action, target, IP)",
    storage: "audit_log",
    purpose: "Answer who did what — required for approvals, budget stops, and incident investigation.",
    retention: "For the life of the organization.",
    sweepDays: null,
    onDeletion: "Deleted with the organization.",
  },
  {
    id: "support",
    data: "Support tickets and their threads",
    storage: "support_tickets, documents, document_versions",
    purpose: "Let an agent (or you) answer customer and team questions with the history intact.",
    retention: "For the life of the company.",
    sweepDays: null,
    onDeletion: "Deleted with the company.",
  },
  {
    id: "account_records",
    data: "Account records (name, email address, password hash, memberships, settings)",
    storage: "users, organizations, memberships, invitations",
    purpose: "Operate your account and authenticate you.",
    retention: "Until you delete the account.",
    sweepDays: null,
    onDeletion: "Deleted immediately when you confirm account deletion.",
  },
  {
    id: "backups",
    data: "Encrypted database backups taken by the operator",
    storage: "Operator-controlled backup storage",
    purpose: "Recover from a failure or data-loss incident.",
    retention: "Rolling 30 days; older backups are destroyed.",
    sweepDays: null,
    onDeletion: "Records deleted from production disappear from backups as the 30-day window rolls forward.",
  },
];

/** Rules the retention sweep enforces. Kept next to the policy so the two cannot drift. */
export function sweptRules(): RetentionRule[] {
  return RETENTION_POLICY.filter((r) => r.sweepDays !== null);
}

export function retentionRule(id: string): RetentionRule | undefined {
  return RETENTION_POLICY.find((r) => r.id === id);
}
