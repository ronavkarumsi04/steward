import type { LegalDocument } from "./types.js";

/** Data-protection, disclosure and governance documents. */

const INTEGRATIONS: LegalDocument = {
  slug: "integrations",
  title: "Integrations and Connected Accounts",
  summary: "What each connection lets {{serviceName}} read or do, what data flows where, and how to revoke it.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "how",
      heading: "1. What connecting an account does",
      blocks: [
        { kind: "p", text: "Integrations are optional and none are enabled by default. When you connect a service you authorize {{serviceName}} to call that provider on your behalf using the access the provider grants. Depending on the integration, that can mean reading data, writing data, and taking actions that other people will see." },
        { kind: "p", text: "Read this page before you connect something. The same information is shown in the app when you configure an integration, and the exact scopes are shown by the provider on its own consent screen." },
      ],
    },
    {
      id: "access-model",
      heading: "2. How access works",
      blocks: [
        { kind: "list", items: [
          "Credentials are encrypted at rest with your deployment's master key and are never displayed back in plain text.",
          "Agents can only use an integration if your policies allow the corresponding action dimension.",
          "Externally visible actions — sending, posting, publishing, deploying, paying — are gated by your approval rules.",
          "Disconnecting an integration deletes the stored credential and stops future calls. It does not undo actions already taken or data the provider already has.",
          "Revoking access at the provider (for example Google's third-party access page, or GitHub's installations page) also stops calls immediately. If you revoke there, {{serviceName}} will show the integration as needing to be reconnected.",
        ]},
      ],
    },
    {
      id: "google",
      heading: "3. Google: Gmail, Calendar, Drive",
      blocks: [
        { kind: "p", text: "The Google integration is the most sensitive connection the Service offers, because Gmail access can expose large amounts of personal information and because Google classifies parts of it as restricted." },
        { kind: "table", head: ["Access requested", "What it allows", "Google's classification"], rows: [
          ["gmail.readonly", "Read messages, threads, labels, and headers in mailboxes you connect", "Restricted scope"],
          ["gmail.send", "Send mail from your connected address", "Sensitive scope"],
          ["Calendar (read and, if enabled, write)", "Read events and create or modify them", "Sensitive scope"],
          ["userinfo.email, userinfo.profile", "Identify the connected account (email address and name)", "Non-sensitive"],
        ]},
        { kind: "list", items: [
          "Gmail content is used to populate features you asked for: the support inbox, contact records, and agent drafts or replies that you authorize. Message metadata and bodies are stored in your organization's database as part of your data.",
          "Calendar data is used to show your schedule and to create or update events you authorize.",
          "Google user data is not used for advertising, is not sold, is not used to train generalized AI models, and is not read by humans except with your permission for support, for security investigation, or where the law requires it.",
          "When an agent's task requires it, the relevant content can be sent to the model provider you configured, under your own agreement with that provider.",
          "Our use of Google user data is limited to the purposes above and complies with the Google API Services User Data Policy, including the Limited Use requirements. The Privacy Policy restates this disclosure.",
        ]},
        { kind: "callout", tone: "warn", title: "Connect the narrowest account you can", text: "If you only need campaign sending, consider a dedicated mailbox rather than an executive's primary account. Least privilege applies to mailboxes as much as to API keys." },
      ],
    },
    {
      id: "categories",
      heading: "4. Other integration categories",
      blocks: [
        { kind: "defs", items: [
          { term: "Code hosting (GitHub)", text: "Repository contents, issues, pull requests, and workflow runs. Agents can open branches, commit, and open pull requests when policy allows; destructive git operations require approval." },
          { term: "Messaging (Slack, Discord)", text: "Posting to channels you authorize and reading channels the app is added to. Treat channel content as visible to everyone in that channel." },
          { term: "Email delivery (Resend, Postmark, SendGrid, SMTP)", text: "Sending email from your domain. Delivery status and provider message IDs come back into the run history." },
          { term: "SMS (Twilio)", text: "Sending SMS from your number and receiving delivery receipts and replies. Consent, STOP handling, and quiet hours are your obligations; the Service enforces suppression and honors opt-out keywords." },
          { term: "Payments (Stripe)", text: "Reading charges, customers, subscriptions, and revenue metrics. Nothing is charged to your customers unless you enable that action and approve it." },
          { term: "CRM and workspace tools (HubSpot, Notion, Supabase, Neon)", text: "Reading and writing records you authorize. Agents can overwrite records, so review the action list before granting write access." },
          { term: "Deployment (Vercel, Render)", text: "Reading project state and, if you allow it, triggering deployments. Production deploys are treated as critical actions requiring approval." },
          { term: "Social publishing (LinkedIn, X)", text: "Publishing posts and reading analytics for accounts you authorize. Published content is public and effectively permanent." },
          { term: "Model providers (OpenAI, Anthropic, Gemini, Bedrock, Ollama, and others)", text: "Receiving prompts and content for each model call under your own API key. Your agreement with the provider governs their handling of it." },
        ]},
      ],
    },
    {
      id: "your-duty",
      heading: "5. Your responsibilities",
      blocks: [
        { kind: "list", items: [
          "Only connect accounts you are authorized to connect, and only grant scopes you actually need.",
          "Do not use an integration in a way that breaks the provider's terms — for example bulk messaging through a provider that forbids it.",
          "Tell the people whose data is in the connected system what you are doing with it, where the law requires it.",
          "Keep an eye on the audit trail: you can see every tool call, and every external action is recorded with its authorization.",
          "Disconnect integrations you no longer use. Dormant credentials are the most common way an incident becomes serious.",
        ]},
      ],
    },
  ],
};

const SUBPROCESSORS: LegalDocument = {
  slug: "subprocessors",
  title: "Subprocessors",
  summary: "The vendors {{serviceName}} itself uses to run the hosted service, and how changes are announced.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "business-customers",
  sections: [
    {
      id: "what",
      heading: "1. What this page lists",
      blocks: [
        { kind: "p", text: "This page lists the third parties {{operatorName}} engages to run the hosted Service, what each receives, and where it operates. The table is generated from the deployment's own configuration, so it reflects what is actually switched on rather than an aspirational list." },
        { kind: "callout", tone: "info", title: "Not every provider is a subprocessor", text: "Model providers, mailboxes, CRMs, and other services you connect are your own providers, not our subprocessors: you hold the contract, you supply the key, and they act on your instructions. They are listed separately on the Integrations page." },
      ],
    },
    {
      id: "changes",
      heading: "2. Changes to subprocessors",
      blocks: [
        { kind: "p", text: "We version this page. Before adding a subprocessor that will process personal data on our instructions, we will update this page and give notice in the app or by email at least 30 days before the change takes effect, so that business customers can object as the Data Processing Addendum allows. Where a change is required immediately for security or legal reasons, we will notify you as soon as we can." },
      ],
    },
    {
      id: "self-hosted",
      heading: "3. If you self-host",
      blocks: [
        { kind: "p", text: "A self-hosted deployment has no subprocessors as far as we are concerned: you run the database, the workflow engine, and the application yourself. Anything you connect from your own deployment — a managed database, an object store, your own email provider — is your own vendor relationship, and you should publish your own subprocessor list." },
      ],
    },
  ],
};

const DPA: LegalDocument = {
  slug: "dpa",
  title: "Data Processing Addendum",
  summary: "The processor terms that apply when {{serviceName}} handles personal data on your behalf.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "business-customers",
  sections: [
    {
      id: "roles",
      heading: "1. Roles and scope",
      blocks: [
        { kind: "p", text: "This Data Processing Addendum (\"DPA\") applies when you use the hosted Service to process personal data and forms part of the Terms of Service. In that relationship you are the controller (or a processor for your own customers) and {{operatorName}} is the processor." },
        { kind: "table", head: ["Item", "Detail"], rows: [
          ["Subject matter", "Provision of the hosted Steward service, including agent execution, storage, and the integrations you enable"],
          ["Duration", "The term of your agreement, until personal data is deleted in accordance with the Retention Policy"],
          ["Nature and purpose", "Storing, retrieving, transforming, transmitting, and displaying personal data to run the features you use; sending communications you instruct"],
          ["Types of personal data", "Account data of your users; contact and customer records; message content; identifiers and technical data; any personal data you include in prompts, documents, or connected-system data"],
          ["Categories of data subjects", "Your users and team members; your customers, prospects, and their personnel; people who correspond with your organization through connected systems"],
          ["Special categories", "Not intended. If you process special-category data (health, biometric, political, etc.) it is your decision and your responsibility to have a lawful basis and appropriate safeguards"],
        ]},
      ],
    },
    {
      id: "obligations",
      heading: "2. Processor obligations",
      blocks: [
        { kind: "list", items: [
          "Instructions. We process personal data only on your documented instructions, including those expressed through your configuration of the Service and the actions you approve. We will tell you if an instruction appears to breach data-protection law, and we may suspend it until you confirm.",
          "Confidentiality. People who can access personal data are under confidentiality obligations and are limited to those who need access to operate, secure, or support the Service.",
          "Security. We apply the technical and organizational measures described on the Security page, including encryption in transit, encrypted credentials at rest, hashed passwords, session and CSRF protections, rate limiting, and audit logging.",
          "Assistance with data-subject rights. The app provides export, correction, and deletion; where a request goes beyond those, we assist you within reasonable effort and time.",
          "Assistance with impact assessments. We provide the information reasonably needed for a DPIA or a prior consultation with a supervisory authority, including this DPA, the subprocessor list, and the security measures.",
          "Breach notification. We notify you without undue delay after becoming aware of a personal-data breach affecting your data, with the information you need to meet your own notification duties, and we keep you updated.",
          "Deletion and return. On termination you can export your data in a machine-readable form. We then delete it in accordance with the Retention Policy, except where law requires retention or where suppression records must persist to honor an opt-out.",
          "Audit. We answer reasonable written questions about our compliance with this DPA. If you need an on-site audit, we will agree the scope, timing, and confidentiality terms in advance; audits must not compromise other customers' security.",
          "Subprocessors. You authorize the subprocessors listed on the Subprocessors page. We impose data-protection obligations on them by contract and remain responsible for their performance as required by law. We give notice of intended changes and let you object, and where you object on reasonable data-protection grounds we will work with you to find a solution.",
        ]},
      ],
    },
    {
      id: "transfers",
      heading: "3. International transfers",
      blocks: [
        { kind: "p", text: "Where personal data protected by the GDPR is transferred from the EEA to a country without an adequacy decision, the parties agree that the Standard Contractual Clauses (Implementing Decision (EU) 2021/914, Module Two for controller-to-processor, or Module Three for processor-to-processor where your customer is the controller) apply and are incorporated by reference. Where UK GDPR applies, the UK Addendum issued by the Information Commissioner's Office applies, with the SCCs as completed." },
        { kind: "p", text: "The parties agree that for the purposes of the SCCs, your acceptance of these terms is the signature, the governing law of the SCCs is the law of Ireland (or, for UK transfers, the law of England and Wales), and the supervisory authority is that of the member state where you are established, or where the data was placed if you are not established in the EEA." },
        { kind: "p", text: "We will notify you if we become subject to a legally binding request for your personal data by a public authority, unless prohibited by law, and we will disclose only the minimum necessary and challenge disproportionate requests where we can." },
      ],
    },
    {
      id: "self-hosted-dpa",
      heading: "4. Self-hosted deployments",
      blocks: [
        { kind: "p", text: "If you self-host, we are not a processor for that deployment — there is no processing by us at all. You act as the operator and must enter your own agreements with your own vendors. This DPA does not apply, though the Retention Policy and Security page remain useful as documentation of the software's behaviour." },
      ],
    },
    {
      id: "contact-dpa",
      heading: "5. Signing a separate DPA",
      blocks: [
        { kind: "p", text: "If your compliance team needs an executed, countersigned DPA — including annexed SCCs with your entity details — contact {{contact}} and we will issue one. Until a countersigned copy exists, this page and the terms incorporated by reference are the operative DPA." },
      ],
    },
  ],
};

const RETENTION: LegalDocument = {
  slug: "retention",
  title: "Data Retention and Deletion Policy",
  summary: "How long each category of data lives, and exactly what deletion does — including the two things it does not remove.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "principle",
      heading: "1. How we set retention",
      blocks: [
        { kind: "p", text: "We keep data only as long as we need it for the purpose it was collected for, or as long as the law requires. Four principles decide every window on this page:" },
        { kind: "list", items: [
          "Short-lived technical data — sessions, one-time tokens, invitations, activity events, webhook logs — expires automatically. A scheduled sweep enforces these windows, and the numbers below are the same values the sweep reads.",
          "The record of what your agents did is kept for the life of the company, because an audit trail that silently expires is not an audit trail. You control it by deleting the company or the account.",
          "Opt-out records outlive the account, because suppressing a person who asked not to be contacted is a continuing legal obligation. They are kept in minimized form and used for nothing else.",
          "Data you delete is removed from production immediately. Backups are rolling, so a deleted record can persist in a backup for up to 30 days before that window rolls off.",
        ]},
      ],
    },
    {
      id: "sweep",
      heading: "2. Automatic expiry",
      blocks: [
        { kind: "p", text: "The table on this page is generated from the Service's retention configuration. Rows with a machine-enforced window are deleted by a scheduled job; rows marked as account-life are removed when you delete the company or account." },
      ],
    },
    {
      id: "deletion",
      heading: "3. What deletion actually does",
      blocks: [
        { kind: "p", text: "Deleting a company, an organization, or your account runs a real deletion, not a flag. It:" },
        { kind: "list", items: [
          "Permanently removes the organization's rows from the production database, including companies, projects, tasks, runs, steps, model and tool calls, approvals, decisions, budgets and ledger, conversations and messages, memories and embeddings, artifacts and their file bytes, campaigns, contacts, leads, outbound messages, support tickets, documents and versions, signals, and audit entries.",
          "Revokes active sessions for the affected users and deletes pending invitations.",
          "Deletes stored integration credentials, provider keys, and API keys, and revokes OAuth grants where the provider supports revocation.",
          "Deletes rows in the workflow engine that reference the deleted runs, so no further work is scheduled.",
        ]},
        { kind: "p", text: "It does not remove (a) suppression records, kept in minimized form to honor opt-outs, or (b) records we must keep to comply with law, resolve a dispute, or prove that a send was lawful. Those records are described in the table and are not used for any other purpose." },
      ],
    },
    {
      id: "individual",
      heading: "4. Deleting individual things",
      blocks: [
        { kind: "list", items: [
          "Conversations and messages: delete a conversation and it is gone, along with its messages.",
          "Memories: delete a memory and its embedding is deleted with it.",
          "Artifacts: delete the file and the bytes are removed from storage.",
          "Contacts: delete a contact; opt-out status is retained separately in the suppression list so a deleted contact is not re-added and re-contacted.",
          "Integrations: disconnecting deletes the credential, which also ends the data flow.",
        ]},
      ],
    },
    {
      id: "requests",
      heading: "5. Privacy requests",
      blocks: [
        { kind: "p", text: "Access, export, correction, and deletion requests can be made in the app or by contacting {{contact}}. We verify identity before acting, log the request, and respond within the period the law allows. If you are our customer's customer, contact that organization first — we support them in answering you." },
      ],
    },
    {
      id: "backup",
      heading: "6. Backups and disaster recovery",
      blocks: [
        { kind: "p", text: "Operators of the hosted Service take encrypted database backups on a rolling 30-day window and store the deployment's master key separately from the backups. Restoration is tested, not assumed. If you self-host, backups are entirely your responsibility — the deployment guide includes a backup and restore procedure to start from." },
      ],
    },
  ],
};

const SECURITY: LegalDocument = {
  slug: "security",
  title: "Security",
  summary: "What {{serviceName}} actually does to protect your data, and what it does not do yet.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "honesty",
      heading: "1. No certification claims",
      blocks: [
        { kind: "callout", tone: "warn", title: "What we do not claim", text: "{{serviceName}} is not SOC 2 certified, not ISO 27001 certified, and not independently audited or penetration-tested. There is no KMS or HSM: encryption keys live in the deployment's environment. There is no hardware-backed key custody and no third-party security attestation. If a vendor claims these things on a page like this without evidence, ask them for the report — here we simply say we do not have them yet." },
      ],
    },
    {
      id: "measures",
      heading: "2. Controls that are implemented",
      blocks: [
        { kind: "defs", items: [
          { term: "Encryption in transit", text: "TLS for the web app and API. Postgres and Temporal connections should be TLS-enabled in production; the deployment guide explains the certificate paths and the pitfall of a stray whitespace value in the Temporal API key that silently enables TLS." },
          { term: "Secrets at rest", text: "Provider keys, integration credentials, and OAuth tokens are encrypted with the deployment master key (AES-256-GCM with a versioned key and support for rotation to a new key via STEWARD_PREVIOUS_MASTER_KEYS). Ciphertext is useless without the key, which is why you must back it up separately." },
          { term: "Passwords", text: "Stored as salted hashes, never in plain text. Password minimum length is enforced. Password reset tokens are single-use and expire in 30 minutes." },
          { term: "Sessions", text: "Random tokens, stored only as hashes; httpOnly, SameSite=Lax cookies; Secure when served over HTTPS; 14-day sliding expiry; rotation on use; per-session IP and user agent recorded; sign-out-everywhere revokes all sessions." },
          { term: "CSRF and CORS", text: "State-changing cookie-authenticated requests must originate from the app's own origin; the API's CORS allowlist is explicit and credentials are never reflected to unknown origins." },
          { term: "Tenant isolation", text: "Every tenant table carries an organization and company scope, and the API resolves scope from the authenticated membership before any query runs. Cross-tenant access is rejected by design, and the test suite covers it." },
          { term: "Rate limiting", text: "Per-IP limits on authentication endpoints, generous limits on the API, and separate limits on webhooks." },
          { term: "Audit trail", text: "Administrative and sensitive actions, approvals, decisions, model calls, tool calls, and spend are recorded with their actor and authorization." },
          { term: "Agent safety rails", text: "Risk-classified tools, autonomy levels 0–4 with no unrestricted mode, approval gates for externally visible and critical actions, per-category budgets with hard stops, suppression and duplicate-send prevention, and treatment of third-party content as untrusted data rather than instructions." },
          { term: "Security headers", text: "The API sends nosniff, frame-deny, no-referrer, no-store, and a restrictive content-security policy; the web app sets its own header set, including HSTS in production." },
        ]},
      ],
    },
    {
      id: "not-yet",
      heading: "3. Known limitations, published on purpose",
      blocks: [
        { kind: "list", items: [
          "No MFA or WebAuthn yet. A stolen password plus a valid session is enough to sign in. Use a long unique password, and revoke sessions from another device if you suspect a compromise.",
          "Keys are environment-held, not KMS/HSM-backed. Anyone with access to the deployment environment and the master key can decrypt stored credentials.",
          "The sandbox is not a hard security boundary. Docker isolation reduces risk; it does not make hostile code safe. Do not run untrusted code you would not run on your own machine.",
          "No third-party penetration test has been completed, and there is no bug bounty.",
          "There is no single sign-on (SAML/OIDC) for organizations yet.",
        ]},
        { kind: "p", text: "These limitations are tracked publicly in the repository's threat model so that a security review can start from an accurate picture rather than a marketing page." },
      ],
    },
    {
      id: "report",
      heading: "4. Reporting a vulnerability",
      blocks: [
        { kind: "p", text: "Do not open a public issue for a security problem. Report it privately: {{contact}}. Include what you found, how to reproduce it, and the affected version or commit. We aim to acknowledge reports within three business days, and we will tell you what we intend to do, keep you updated on the fix, and credit you if you would like." },
        { kind: "p", text: "Please give us a reasonable opportunity to fix the issue before disclosing it publicly, do not access other people's data, and do not run destructive tests. Good-faith research on your own deployment is welcome." },
      ],
    },
    {
      id: "incident",
      heading: "5. If something goes wrong",
      blocks: [
        { kind: "p", text: "We maintain a documented incident-response process covering detection, severity, containment, credential and token revocation, evidence preservation, subprocessor notification, customer communication, and regulatory assessment. Where a personal-data breach affects your data, we notify you without undue delay after becoming aware, with the information you need to meet your own obligations, and we follow up with a written postmortem when the incident is closed." },
        { kind: "p", text: "For self-hosted deployments, incident response is yours; the repository's incident-response runbook is written so you can adapt it, including the steps for revoking integration credentials and rotating the master key." },
      ],
    },
    {
      id: "your-part",
      heading: "6. What we need from you",
      blocks: [
        { kind: "list", items: [
          "Use a long, unique password and keep it in a password manager.",
          "Grant the narrowest integration scopes you can, and disconnect integrations you stop using.",
          "Keep the master key backed up, and rotate it if anyone with access leaves.",
          "Set autonomy levels and budgets deliberately; treat approval prompts as decisions, not confirmations.",
          "Keep your own backups of anything you cannot afford to lose.",
        ]},
      ],
    },
  ],
};

const ACCESSIBILITY: LegalDocument = {
  slug: "accessibility",
  title: "Accessibility Statement",
  summary: "The accessibility target for {{serviceName}}, what has been implemented, and what has not been verified yet.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "target",
      heading: "1. Our target",
      blocks: [
        { kind: "p", text: "We aim to meet WCAG 2.2 Level AA for the web application. This is a target, not a certification: no independent accessibility audit has been performed, so we do not claim conformance." },
      ],
    },
    {
      id: "implemented",
      heading: "2. What is implemented so far",
      blocks: [
        { kind: "list", items: [
          "Semantic landmarks, headings, and form labels, with an accessible name on every control.",
          "A visible focus ring and full keyboard reachability for dialogs and the command palette, with focus trapped in the dialog and returned to the trigger on close.",
          "Status and error messages exposed to assistive technology through ARIA live regions, so a failed save or a completed run is announced rather than only shown.",
          "Chat transcripts marked as logs with polite live updates; run status exposed as a status region.",
          "A light/dark/system theme that respects the operating-system preference, with sufficient contrast for text and focus indicators in both themes.",
          "Reduced-motion support: animations are suppressed when the operating system asks for reduced motion.",
          "Skeletons and loading states that announce what is happening instead of flashing empty content.",
          "Respect for color-independence: statuses are labelled, not only color-coded.",
        ]},
      ],
    },
    {
      id: "not-verified",
      heading: "3. Not yet verified",
      blocks: [
        { kind: "list", items: [
          "Screen-reader testing with NVDA, JAWS, and VoiceOver has not been completed across every page.",
          "A full keyboard-only pass across all flows, including the workflow canvas and drag interactions, has not been documented.",
          "Zoom and reflow at 400% has not been verified on every screen.",
          "No audit against WCAG 2.2 AA has been performed by a third party.",
        ]},
      ],
    },
    {
      id: "feedback",
      heading: "4. Feedback and remediation",
      blocks: [
        { kind: "p", text: "If something is unusable with assistive technology, tell us: {{contact}}. Include the page, the assistive technology you use, and what happened. We treat accessibility defects as bugs, give them a priority at least as high as an equivalent functional bug, and we will tell you what we changed." },
        { kind: "p", text: "If you self-host, the fixes land in the software through the normal open-source process, and you can also fix anything we have missed and send a pull request." },
      ],
    },
  ],
};

const API_TERMS: LegalDocument = {
  slug: "api-terms",
  title: "API and Webhook Terms",
  summary: "Rules for using the {{serviceName}} API and for receiving webhooks.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "business-customers",
  sections: [
    {
      id: "keys",
      heading: "1. Credentials",
      blocks: [
        { kind: "list", items: [
          "API keys are scoped to your organization and act with the authority of the key's owner. Treat them as secrets: store them in a secret manager, never in client-side code or a public repository.",
          "Do not share keys between environments or reuse a key for unrelated systems.",
          "We may revoke a key that we believe has leaked, is being abused, or is being used to attack the Service.",
          "You are responsible for everything done with your keys. If a key is compromised, revoke it immediately and revoke the sessions of the affected user.",
        ]},
      ],
    },
    {
      id: "limits",
      heading: "2. Fair use and rate limits",
      blocks: [
        { kind: "p", text: "The API applies rate limits and returns 429 with a retry hint when you exceed them. Do not attempt to work around them, and do not build a service whose operation depends on bypassing them. Bulk operations should use the batch endpoints and the workflow engine rather than polling in a tight loop." },
        { kind: "p", text: "We may change rate limits to protect the Service. Because the API is at version 0.1 and the Service is pre-1.0, endpoints can change; breaking changes are noted in release notes." },
      ],
    },
    {
      id: "webhooks",
      heading: "3. Webhook responsibilities",
      blocks: [
        { kind: "list", items: [
          "Verify the signature on every delivery before acting on it. The header and scheme for each provider are documented in the integration's definition; deliveries are signed with your webhook secret.",
          "Respond quickly (aim for under 5 seconds) and process heavy work asynchronously. A slow endpoint is indistinguishable from a failing one.",
          "Expect retries and duplicates: make your handler idempotent using the delivery identifier.",
          "Never trust a webhook payload as an instruction to your own systems without validating it — treat it the way the Service treats third-party content, as untrusted data.",
          "Keep the endpoint behind TLS, and rotate the signing secret if it is exposed.",
        ]},
      ],
    },
    {
      id: "prohibited-api",
      heading: "4. Prohibited API use",
      blocks: [
        { kind: "list", items: [
          "Automating the creation of accounts, or reselling access to the hosted Service without a written agreement.",
          "Using the API to extract data belonging to organizations you are not a member of.",
          "Probing, scanning, or attacking the Service or other tenants, or using automation to gain a rate-limit or policy advantage.",
          "Building a service whose value depends on the Service's availability when no service level exists — see the Support Policy for what we commit to.",
        ]},
      ],
    },
  ],
};

const COPYRIGHT: LegalDocument = {
  slug: "copyright",
  title: "Copyright and IP Complaints",
  summary: "How to report content that infringes your rights, and what we do about repeat infringement.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "scope",
      heading: "1. Where this applies",
      blocks: [
        { kind: "p", text: "{{serviceName}} workspaces are private, but agents can publish content to public places through connected services — social posts, for example. This policy covers content stored in the Service and content published through it. Content published on a third-party platform is also subject to that platform's notice process." },
      ],
    },
    {
      id: "notice",
      heading: "2. Filing a notice",
      blocks: [
        { kind: "p", text: "If you believe content in the Service infringes your copyright, send a notice to {{contact}} with:" },
        { kind: "list", items: [
          "Identification of the work you say is infringed (or a representative list if several).",
          "The exact location of the allegedly infringing material — the URL, the organization, and enough detail for us to find it.",
          "Your name, mailing address, telephone number, and email address.",
          "A statement that you have a good-faith belief the use is not authorized by the rights holder, its agent, or the law.",
          "A statement, under penalty of perjury, that the information is accurate and that you are the rights holder or authorized to act for one.",
          "Your physical or electronic signature.",
        ]},
        { kind: "p", text: "Send the same notice to the platform where the content was published if it is live there, since only that platform can remove it." },
      ],
    },
    {
      id: "response",
      heading: "3. What we do",
      blocks: [
        { kind: "list", items: [
          "We review notices and, where they are complete and credible, remove or disable access to the reported material and notify the account holder.",
          "The account holder can send a counter-notice explaining why the removal was mistaken, including consent to jurisdiction and the same signature and accuracy requirements.",
          "Where we receive a valid counter-notice, we may restore the material unless the original complainant tells us they have filed an action.",
          "We keep records of notices and actions.",
          "Accounts that repeatedly receive substantiated infringement notices or that use the Service to infringe systematically may be suspended or terminated.",
        ]},
      ],
    },
    {
      id: "agent-output",
      heading: "4. Agent-generated content and copyright",
      blocks: [
        { kind: "p", text: "Model output can resemble existing works, and the copyright status of AI-assisted output varies by jurisdiction. You are responsible for checking that content your agents produce and publish does not infringe third-party rights. If you use the Service to publish at scale, put a human review step in the path — that is what approval gates are for." },
      ],
    },
  ],
};

const THIRD_PARTY: LegalDocument = {
  slug: "third-party-notices",
  title: "Third-Party Notices",
  summary: "The open-source components shipped with {{serviceName}}, and the licenses they are provided under.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "project",
      heading: "1. Steward's own license",
      blocks: [
        { kind: "p", text: "{{serviceName}} itself is licensed under the Apache License 2.0. That license governs the software and grants you the rights it describes — including patent rights — and requires that copyright and attribution notices be preserved. It does not grant rights in the {{serviceName}} name or logos." },
        { kind: "callout", tone: "info", title: "Open-source license vs. hosted terms", text: "The Apache-2.0 license covers the code you run. It is not the agreement for the hosted service, which is what the Terms of Service is for. Self-hosting under Apache-2.0 gives you no rights to our hosted instance, and using the hosted instance gives you no extra rights in the code." },
      ],
    },
    {
      id: "components",
      heading: "2. Components and notices",
      blocks: [
        { kind: "p", text: "The Service ships third-party open-source components, including the web framework, database driver and ORM, workflow engine and its SDKs, validation and logging libraries, and cloud SDKs. Each is provided under its own license, and the required attributions and license texts are preserved in the repository." },
        { kind: "p", text: "The generated notice file (docs/THIRD_PARTY_NOTICES.md) is produced from the dependency graph of the exact version you are running, listing each component's name, version, declared license, and repository. Regenerate it whenever dependencies change:" },
        { kind: "list", items: [
          "Run the generator script in the repository to refresh the notices file.",
          "The file is checked into the repository so that every released version has a written record.",
          "If you redistribute {{serviceName}}, ship that file and any license texts it references so downstream users receive the notices they are entitled to.",
        ]},
      ],
    },
    {
      id: "no-endorsement",
      heading: "3. No endorsement",
      blocks: [
        { kind: "p", text: "Listing a component or an integration does not mean its authors endorse {{serviceName}}, and it does not make them a party to your agreement with us." },
      ],
    },
  ],
};

const SUPPORT: LegalDocument = {
  slug: "support",
  title: "Support Policy",
  summary: "How to get help with {{serviceName}}, and what we do not promise.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "channels",
      heading: "1. How to get help",
      blocks: [
        { kind: "table", head: ["Channel", "Use it for", "Response expectation"], rows: [
          ["In-app feedback and the repository issue tracker", "Bugs, feature requests, documentation gaps", "Best effort, typically within a few business days"],
          ["{{repositoryUrl}}", "Code-level questions and self-hosted help", "Community-driven; maintainers and other operators answer"],
          ["{{contact}}", "Security reports, privacy requests, legal notices, abuse reports", "Security acknowledged within three business days; others as the law requires"],
        ]},
      ],
    },
    {
      id: "no-sla",
      heading: "2. No service-level commitment at launch",
      blocks: [
        { kind: "callout", tone: "warn", title: "We do not promise uptime", text: "There is no SLA, no uptime percentage, no availability credit, and no contractual support response time for the hosted Service. It is operated as an open-source project on a best-effort basis. Do not build a business process that cannot tolerate an outage, and do not rely on the hosted instance for anything you cannot afford to lose. If you need guarantees, self-host on infrastructure you control." },
        { kind: "p", text: "If a formal SLA is ever offered, it will be a separate written agreement with defined scope, exclusions, maintenance windows, severity levels, and remedies — and the infrastructure will have to be able to support it before it is advertised." },
      ],
    },
    {
      id: "boundaries",
      heading: "3. What support does not cover",
      blocks: [
        { kind: "list", items: [
          "Your own custom deployments, infrastructure, or database administration, beyond the documented deployment guide.",
          "Debugging your prompts, models, or agent prompts to produce a specific business outcome.",
          "Third-party services you connect — use the provider's own support for those.",
          "Recovery of data you deleted, or of encrypted credentials when the master key is lost. Neither is technically possible.",
          "Requests to bypass security controls, such as un-suppressing a recipient or restoring access to a terminated account.",
        ]},
      ],
    },
    {
      id: "maintenance",
      heading: "4. Maintenance and communication",
      blocks: [
        { kind: "p", text: "For the hosted instance we aim to perform disruptive maintenance outside US business hours where we can, and we announce it in the app. Incidents affecting availability are noted in the repository, and security-relevant incidents are notified as described on the Security page and in the Data Processing Addendum." },
      ],
    },
  ],
};

export const DATA_DOCUMENTS: LegalDocument[] = [INTEGRATIONS, SUBPROCESSORS, DPA, RETENTION, SECURITY, ACCESSIBILITY, API_TERMS, COPYRIGHT, THIRD_PARTY, SUPPORT];
