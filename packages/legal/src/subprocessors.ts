/**
 * Subprocessor register.
 *
 * A subprocessor is a vendor *we* use to run the hosted Service. A customer-connected service
 * (Slack, Google, GitHub, Stripe, Twilio, a model provider…) is NOT a subprocessor: you connect it,
 * you contract with it, and it acts on your instructions. The two lists are kept separate on
 * purpose — conflating them is a common and misleading shortcut.
 *
 * Entries are derived from the deployment's real configuration so this page cannot claim a vendor
 * we do not use, or hide one we do.
 */

export type SubprocessorStatus = "in use" | "not active";

export interface Subprocessor {
  /** Stable role identifier, so the page always shows one row per role. */
  id: "hosting" | "database" | "storage" | "workflow" | "email" | "extra";
  name: string;
  role: string;
  dataCategories: string[];
  location: string;
  transferMechanism: string;
  status: SubprocessorStatus;
}

/** A service the customer connects, shown separately from subprocessors. */
export interface CustomerConnectedService {
  name: string;
  category: string;
  /** What enabling it lets Steward do. */
  access: string;
  /** Who the customer's agreement is with. */
  contract: string;
}

export const CUSTOMER_CONNECTED_SERVICES: CustomerConnectedService[] = [
  { name: "Google (Gmail, Calendar, Drive)", category: "Email, calendar, files", access: "Read (gmail.readonly), send (gmail.send), calendar read/create, and file access you grant", contract: "Your Google account terms and Google's API Services User Data Policy" },
  { name: "GitHub", category: "Code", access: "Repository read/write, issues and pull requests, workflow runs, depending on the installation you approve", contract: "Your GitHub agreement" },
  { name: "Slack", category: "Messaging", access: "Post messages to channels you authorize, read channels you add the app to", contract: "Your Slack agreement" },
  { name: "Discord", category: "Messaging", access: "Send messages to channels you authorize", contract: "Your Discord agreement" },
  { name: "Stripe", category: "Payments", access: "Read charges, customers, subscriptions, and revenue metrics; create records only where you enable it", contract: "Your Stripe agreement" },
  { name: "Twilio", category: "SMS", access: "Send SMS from your number or messaging service; receive delivery and inbound status webhooks", contract: "Your Twilio agreement" },
  { name: "Resend, Postmark, SendGrid, SMTP", category: "Email delivery", access: "Send email from your domain through your own account", contract: "Your agreement with that provider" },
  { name: "HubSpot, Salesforce-style CRMs", category: "CRM", access: "Read and write records you authorize", contract: "Your agreement with that provider" },
  { name: "Notion, Supabase, Neon, Vercel, Render", category: "Knowledge, data, deployment", access: "Read and write the resources you connect", contract: "Your agreement with that provider" },
  { name: "LinkedIn, X", category: "Social publishing", access: "Publish posts and read analytics for the accounts you authorize", contract: "Your agreement with that provider" },
  { name: "OpenAI, Anthropic, Google Gemini, Bedrock, Ollama, OpenRouter, and other model providers", category: "AI model inference", access: "Receive the prompts and content needed for each model call, using your own API key", contract: "Your own agreement with the provider, under your own API key" },
];

/**
 * Reads the deployment configuration and reports only what is actually in play.
 * Self-hosted operators should edit this file (or set the env vars below) so the page matches
 * their own infrastructure.
 */
export function subprocessorsFromEnv(env: NodeJS.ProcessEnv = process.env): Subprocessor[] {
  const onVercel = Boolean(env.VERCEL);
  const emailProvider = (env.PLATFORM_EMAIL_PROVIDER ?? "console").trim().toLowerCase();
  const temporalCloud = Boolean(env.TEMPORAL_API_KEY?.trim());
  const managedDb = env.LEGAL_DATABASE_PROVIDER?.trim();
  const region = env.LEGAL_HOSTING_REGION?.trim() || "Region of the operator's choosing";

  const list: Subprocessor[] = [
    {
      id: "hosting",
      name: onVercel ? "Vercel Inc." : "Operator-managed application hosting",
      role: "Serving the web application, TLS termination, and CDN",
      dataCategories: ["Account and session identifiers", "Business content routed through the web app", "Technical request logs"],
      location: onVercel ? "United States (with global edge delivery)" : region,
      transferMechanism: onVercel ? "Standard Contractual Clauses (EU) / UK Addendum" : "Not applicable — operator-controlled infrastructure",
      status: onVercel ? "in use" : "not active",
    },
    {
      id: "database",
      name: managedDb || "Operator-managed PostgreSQL",
      role: "Primary database: stores all organization data at rest",
      dataCategories: ["Everything described in the Privacy Policy, except artifact file bytes", "Encrypted credentials (ciphertext only)"],
      location: region,
      transferMechanism: "Standard Contractual Clauses (EU) / UK Addendum where the provider is outside the EEA/UK",
      status: "in use",
    },
    {
      id: "storage",
      name: "Operator-managed object/file storage",
      role: "Storing artifacts and generated files",
      dataCategories: ["Artifacts: files and generated output"],
      location: region,
      transferMechanism: "Not applicable — operator-controlled storage",
      status: "in use",
    },
    {
      id: "workflow",
      name: temporalCloud ? "Temporal Technologies (Temporal Cloud)" : "Operator-managed Temporal",
      role: "Durable workflow engine: run orchestration, retries, timers, approvals",
      dataCategories: ["Workflow inputs and outputs, including run identifiers and task payloads"],
      location: temporalCloud ? "United States" : region,
      transferMechanism: temporalCloud ? "Standard Contractual Clauses (EU) / UK Addendum" : "Not applicable — operator-controlled infrastructure",
      status: "in use",
    },
    {
      id: "email",
      name: emailProvider === "resend" ? "Resend" : "No third-party transactional email provider",
      role: "Delivering platform email: invitations, password resets, security notices",
      dataCategories: ["Recipient email address", "Message content (invitation links, reset links)"],
      location: "United States",
      transferMechanism: "Standard Contractual Clauses (EU) / UK Addendum",
      status: emailProvider === "resend" ? "in use" : "not active",
    },
  ];

  const extra = env.LEGAL_ADDITIONAL_SUBPROCESSORS?.trim();
  if (extra) {
    for (const entry of extra.split(";")) {
      const [name, role, dataCategories, location] = entry.split("|").map((s) => s.trim());
      if (!name) continue;
      list.push({
        id: "extra",
        name,
        role: role || "Operator-configured service",
        dataCategories: (dataCategories || "").split(",").filter(Boolean),
        location: location || region,
        transferMechanism: "Standard Contractual Clauses where required",
        status: "in use",
      });
    }
  }

  return list;
}
