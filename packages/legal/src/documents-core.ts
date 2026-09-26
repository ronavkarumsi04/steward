import type { LegalDocument } from "./types.js";

/**
 * Core public documents. Text uses `{{token}}` placeholders that the renderer resolves from
 * LegalConfig, so the same source is truthful for a self-hosted operator and for the hosted
 * instance without editing prose.
 */

const TERMS: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary: "The agreement between {{operator}} and you when you use hosted {{serviceName}}.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: true,
  audience: "everyone",
  sections: [
    {
      id: "agreement",
      heading: "1. Who these terms are between",
      blocks: [
        { kind: "p", text: "{{serviceName}} is open-source software distributed under the Apache License 2.0. These Terms of Service (the \"Terms\") are between you and {{operator}} (\"we\", \"us\", \"our\") and govern your use of the hosted {{serviceName}} service at the address where you registered (the \"Service\")." },
        { kind: "callout", tone: "info", title: "No corporate entity is claimed", text: "{{serviceName}} is currently operated as an open-source project without an incorporated legal entity. That is why these Terms name the project's maintainers as the contracting party. If a legal entity is later formed to operate the Service, these Terms will be updated as described in section 21 and the entity's details will appear here." },
        { kind: "p", text: "The software itself is licensed to you under the Apache License 2.0, not under these Terms. If you install and run {{serviceName}} yourself, the open-source license governs the software, and you — not us — are the operator responsible for the deployment, the data in it, and any promises you make to your own users. These Terms apply only to the hosted instance we operate." },
        { kind: "p", text: "By creating an account, clicking to accept these Terms, or using the Service, you agree to these Terms, the Acceptable Use Policy, and the Privacy Policy. If you do not agree, do not use the Service." },
      ],
    },
    {
      id: "eligibility",
      heading: "2. Eligibility and authority",
      blocks: [
        { kind: "list", items: [
          `You must be at least {{minimumAge}} years old and legally able to enter into a binding contract.`,
          "The Service is a business tool. It is not designed for, marketed to, or intended to be used by children, and we do not knowingly collect personal information from children under 13. See the Privacy Policy for how to ask us to delete a child's information.",
          "If you use the Service for an organization, you represent that you are authorized to bind that organization to these Terms, and \"you\" includes that organization.",
          "You must not be subject to trade sanctions or export restrictions that prohibit us from providing the Service to you, and you must not use the Service from a jurisdiction where doing so would be unlawful.",
        ]},
        { kind: "callout", tone: "warn", title: "Your authority to act is your responsibility", text: "Before you connect an account, mailbox, phone number, payment processor, or any other system to {{serviceName}}, you must have the legal right to do so and the right to let software act on it. You confirm that you hold the permissions needed for every integration you enable and every instruction you give an agent." },
      ],
    },
    {
      id: "accounts",
      heading: "3. Accounts and security",
      blocks: [
        { kind: "p", text: "You need an account to use the hosted Service. You must give accurate registration information, keep it current, and keep your credentials confidential. You are responsible for everything done through your account and your organization's memberships." },
        { kind: "p", text: "Sessions last 14 days from sign-in and are refreshed while you use the Service. Signing out revokes the current session; signing out everywhere revokes all of them. You must tell us promptly if you believe your account or an API key has been compromised." },
        { kind: "p", text: "We may suspend or terminate an account to protect the Service or other users, to comply with law, or for breach of these Terms or the Acceptable Use Policy. Where it is practical, we will tell you why and give you an opportunity to fix the problem first." },
        { kind: "p", text: "Administrators of an organization can see and change organization data, invite and remove members, and change roles. If you join an organization, its administrators control your access to its data — ask them, not us, for changes to your membership." },
      ],
    },
    {
      id: "your-data",
      heading: "4. Your content and customer data",
      blocks: [
        { kind: "p", text: "You keep all rights to the content you put into the Service and to the data about your own customers, contacts, and business (\"Your Data\"). We do not claim ownership of it." },
        { kind: "p", text: "You grant us a limited license to store, process, transmit, and display Your Data solely to operate and provide the Service, to secure it, and to comply with law. This license ends when the data is deleted, except for the limited retention described in the Retention Policy." },
        { kind: "p", text: "You are responsible for the legality of Your Data and for having a lawful basis to process it. When you store contacts, send marketing email or SMS, or process personal data about other people through the Service, you are the controller of that data and we act as your processor — see the Data Processing Addendum." },
        { kind: "p", text: "You can export or delete Your Data at any time, as described in the Privacy Policy. Self-hosted deployments keep their data entirely under the operator's control." },
      ],
    },
    {
      id: "agents",
      heading: "5. Agents acting on your behalf",
      blocks: [
        { kind: "p", text: "{{serviceName}} runs autonomous agents that plan and act. That is the point of the product, and it means actions taken through the Service can have real-world effects: emails and messages sent to other people, posts published, code committed, payments or deployments executed where you have connected such systems." },
        { kind: "list", items: [
          "You choose an autonomy level (0–4) and per-dimension policies. Higher levels let agents act with less human review.",
          "Externally visible actions are gated by approval rules you configure. A human approval is an authorization for that specific action.",
          "Budgets are enforced per category. An agent stops when a budget is exhausted.",
          "Every run records its plan, model calls, tool calls, decisions, and cost in an audit trail you can inspect.",
        ]},
        { kind: "callout", tone: "warn", title: "Autonomy does not transfer responsibility", text: "Instructions you give, approvals you grant, and actions your agents take are treated as your acts. Choosing a higher autonomy level, disabling an approval gate, or allowing an agent to act unsupervised does not reduce your responsibility for the outcome. You are responsible for reviewing outputs before relying on them and for complying with the rules of any service your agents touch." },
        { kind: "p", text: "AI outputs can be wrong, incomplete, or biased, and can resemble the work of others. Agents may produce content that is inaccurate or that infringes third-party rights. You must verify anything material before you rely on it, publish it, or act on it — see the AI and Autonomous Agent Terms for the full disclosure." },
        { kind: "p", text: "Agents are not people. Where an agent communicates with a human, that human is entitled to know they are dealing with an AI system, and you must not present agent output as the judgment of a licensed professional or as a human review that did not happen." },
      ],
    },
    {
      id: "keys",
      heading: "6. Your model providers and keys",
      blocks: [
        { kind: "p", text: "{{serviceName}} is bring-your-own-key. You supply the credentials for the model providers and services you want to use. Your use of those providers is governed by your own agreement with them, not by these Terms, and their charges are yours." },
        { kind: "p", text: "Prompts, content, and tool results necessary to fulfil a request are transmitted to the providers you configure. If you connect a hosted provider, its handling of that data is governed by its terms and privacy policy. You are responsible for choosing providers that meet your own confidentiality, residency, and retention requirements — including for personal data you place in prompts." },
        { kind: "p", text: "Credentials you enter are encrypted with the deployment's master key before storage, are never displayed back to you in plain text, and are deleted when you delete them or the account. If you lose the master key, encrypted credentials cannot be recovered, and we cannot recover them for you." },
      ],
    },
    {
      id: "integrations",
      heading: "7. Third-party integrations",
      blocks: [
        { kind: "p", text: "You can connect services such as Google, GitHub, Slack, Stripe, Twilio, email providers, and others. Connecting an integration authorizes us to call that provider on your behalf using the access the provider grants, which may include reading and sending data and taking actions like sending email, posting messages, or creating records." },
        { kind: "list", items: [
          "Enabling an integration can cause data to flow both ways: from {{serviceName}} to the provider and from the provider back into {{serviceName}}.",
          "Your use of each integration is subject to that provider's terms, and you are responsible for complying with them.",
          "You can revoke access at any time in the app by disconnecting the integration; that stops future calls but does not undo actions already taken or data already received by the provider.",
          "We are not responsible for third-party services, including their availability, accuracy, security, or changes to their APIs and policies.",
        ]},
        { kind: "p", text: "The Integrations and Connected Accounts disclosure explains the scopes the Service requests, what each one allows, and the data flows involved, before you connect anything." },
      ],
    },
    {
      id: "outbound",
      heading: "8. Messages you send through the Service",
      blocks: [
        { kind: "p", text: "If you use {{serviceName}} to send email, SMS, or social messages, you are the sender. Laws such as the U.S. CAN-SPAM Act, the Telephone Consumer Protection Act, and equivalent rules elsewhere apply to you, and you must comply with them." },
        { kind: "list", items: [
          "Only send to people you have a lawful basis to contact, and only content you are allowed to send.",
          "Keep headers, subject lines, and sender information truthful, and do not misrepresent who the message is from. Agent-sent messages must not conceal the sending organization.",
          "Honor opt-outs promptly. The Service enforces a suppression list and blocks sends to suppressed recipients, and every marketing email the Service sends includes a working unsubscribe link. Never attempt to work around suppression.",
          "For SMS, obtain the consent the law requires before sending, honor STOP and equivalent replies, and never send to a number that has opted out.",
        ]},
        { kind: "p", text: "We may rate-limit, block, or suspend sending that we reasonably believe is unlawful, deceptive, or likely to damage deliverability for everyone else. Suppression records are kept even after account deletion, because honoring an opt-out is a continuing obligation of the sender." },
      ],
    },
    {
      id: "fees",
      heading: "9. Fees",
      blocks: [
        { kind: "callout", tone: "info", title: "The Service is free at launch; no sales tax or billing terms apply", text: "We do not charge for the hosted Service at this time, and no billing, renewal, or refund terms apply. You pay your model and integration providers directly. If we ever introduce paid plans, we will publish the price and the billing, renewal, cancellation, refund, and tax terms before charging anyone, and we will ask you to accept the updated terms before your first payment." },
      ],
    },
    {
      id: "ip",
      heading: "10. Intellectual property",
      blocks: [
        { kind: "p", text: "The {{serviceName}} software is licensed under Apache-2.0, and that license governs your rights in the source code. These Terms do not restrict rights the open-source license grants you." },
        { kind: "p", text: "We own the {{serviceName}} name, logos, and the hosted Service's own content and documentation. You may not use our marks in a way that suggests endorsement or affiliation without our permission. Third-party open-source components shipped with the Service are listed in the Third-Party Notices page, including their licenses and required attributions." },
        { kind: "p", text: "If you send us feedback or suggestions, you allow us to use them without restriction or compensation. Do not send us confidential information in feedback." },
      ],
    },
    {
      id: "availability",
      heading: "11. Availability and changes to the Service",
      blocks: [
        { kind: "p", text: "The Service is provided on a best-effort basis by an open-source project. We do not promise any uptime percentage, support response time, or service level at launch, and no service-level commitment exists unless we publish a separate written agreement. Planned and unplanned maintenance can interrupt the Service, and features may change or be removed as the project evolves." },
        { kind: "p", text: "We may modify, add, or discontinue features. If we discontinue the hosted Service entirely, we will give reasonable advance notice in the app or by email and a way to export Your Data first." },
      ],
    },
    {
      id: "termination",
      heading: "12. Suspension and termination",
      blocks: [
        { kind: "list", items: [
          "You can stop using the Service at any time and can delete your account in the app. Deletion is permanent and irreversible, as described in the Retention Policy.",
          "We may suspend or terminate access if you materially breach these Terms or the Acceptable Use Policy, if we are required to by law, if your use creates a security or legal risk to us or others, or if the project discontinues the hosted Service.",
          "Where we terminate for convenience, we will give you a reasonable opportunity to export Your Data. Where the breach is serious or unlawful, we may act immediately.",
          "Sections that by their nature should survive termination do: your data license ends, but the disclaimers, liability limits, indemnity, governing law, and dispute provisions remain in force.",
        ]},
      ],
    },
    {
      id: "deletion",
      heading: "13. Export and deletion",
      blocks: [
        { kind: "p", text: "You can export your organization's data as a machine-readable archive and delete your account or organization from the app. Deletion removes Your Data from the production database, revokes sessions and credentials, and disconnects integrations. Because backups exist, deleted records can persist in backups for up to 30 days before their window rolls off." },
        { kind: "p", text: "Some records survive deletion in minimized form where the law or a recipient's opt-out requires it — suppression records and records needed to resolve a dispute or prove compliance. The Retention Policy lists exactly what is kept and why." },
      ],
    },
    {
      id: "disclaimers",
      heading: "14. Disclaimers",
      blocks: [
        { kind: "p", text: "The Service is provided \"as is\" and \"as available\", without warranties of any kind, whether express, implied, or statutory, including merchantability, fitness for a particular purpose, title, and non-infringement. We do not warrant that the Service will be uninterrupted, secure, or error-free, or that AI outputs will be accurate, complete, or suitable for any purpose." },
        { kind: "p", text: "{{serviceName}} does not provide legal, tax, accounting, medical, or financial advice, and nothing an agent produces is professional advice. AI systems can generate incorrect information and can act on it. Do not use the Service for decisions about individuals where the law requires human judgment or a licensed professional, unless a qualified human reviews the outcome." },
        { kind: "p", text: "We do not control and are not responsible for third-party services or for data you choose to send them." },
      ],
    },
    {
      id: "liability",
      heading: "15. Limitation of liability",
      blocks: [
        { kind: "p", text: "To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, business interruption, or the cost of substitute services, even if we were advised such damages were possible." },
        { kind: "p", text: "To the maximum extent permitted by law, our total aggregate liability arising out of or relating to the Service is limited to the greater of (a) the amount you paid us for the Service in the twelve months before the event giving rise to the claim — which is zero while the Service is free — or (b) US $100." },
        { kind: "p", text: "Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, including for fraud, willful misconduct, or death or personal injury caused by negligence where such limits are not permitted." },
      ],
    },
    {
      id: "indemnity",
      heading: "16. Indemnity",
      blocks: [
        { kind: "p", text: "You will indemnify, defend, and hold harmless {{operatorName}} and the project's contributors from claims, damages, liabilities, costs, and reasonable legal fees arising from: (a) Your Data; (b) messages, content, or actions you or your agents send or take through the Service; (c) your integrations, including claims by a provider or a third party about how you used their service; (d) your breach of these Terms; or (e) your violation of law or third-party rights, including spam, consent, privacy, and intellectual-property laws." },
      ],
    },
    {
      id: "disputes",
      heading: "17. Governing law and disputes",
      blocks: [
        { kind: "p", text: "These Terms are governed by {{governingLaw}}, without regard to conflict-of-laws rules. The exclusive venue for disputes is {{venue}}, and both parties consent to jurisdiction there." },
        { kind: "p", text: "Before filing a claim, you agree to contact us and try to resolve the dispute informally for at least 30 days. Nothing here prevents either party from seeking injunctive relief in court to protect its intellectual property or to stop misuse of the Service." },
        { kind: "p", text: "If you are a consumer in a jurisdiction that gives you mandatory rights to sue in your local courts, this section does not remove those rights." },
      ],
    },
    {
      id: "export-control",
      heading: "18. Export and sanctions compliance",
      blocks: [
        { kind: "p", text: "You may not use, export, or re-export the Service in violation of export-control, sanctions, or embargo rules, or if you are located in, or are a national of, an embargoed jurisdiction. You confirm that you are not on any restricted-party list." },
      ],
    },
    {
      id: "changes",
      heading: "19. Changes to the Service's policies",
      blocks: [
        { kind: "p", text: "We may update these Terms, the Acceptable Use Policy, the Privacy Policy, and the other documents linked here. Each document carries a version and an effective date, and we publish previous versions in the repository's git history." },
        { kind: "p", text: "For material changes we will give notice in the app or by email before the change takes effect and will ask you to accept the new version. Where the law requires consent, we will not apply the change to you without it. Continuing to use the Service after a non-material update means you accept the updated version. If you do not agree to a material change, you can stop using the Service and delete your account." },
        { kind: "p", text: "Acceptances are recorded with the document version, timestamp, and the IP address and browser used, so both you and we can see which version you agreed to." },
      ],
    },
    {
      id: "notices",
      heading: "20. General",
      blocks: [
        { kind: "list", items: [
          "Notices to you may be given in the app or to the email address on your account. Notices to us must go to {{contact}}.",
          "If a provision is found unenforceable, the rest of these Terms remain in effect.",
          "You may not assign these Terms without our consent; we may assign them to a successor operating the Service.",
          "These Terms, the Acceptable Use Policy, the Privacy Policy, and any document incorporated by reference are the entire agreement between us about the hosted Service.",
          "There are no third-party beneficiaries, except that the project's contributors may enforce the liability, indemnity, and intellectual-property provisions.",
          "We are not liable for delays caused by events beyond our reasonable control.",
        ]},
      ],
    },
    {
      id: "contact",
      heading: "21. Contact",
      blocks: [
        { kind: "p", text: "Questions about these Terms: {{contact}}. Security reports: see the Security page. Privacy and data-protection requests: see the Privacy Policy." },
        { kind: "p", text: "Effective date of this version: {{effectiveDate}}." },
      ],
    },
  ],
};

const PRIVACY: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  summary: "What {{serviceName}} collects, why, who it goes to, how long we keep it, and how to exercise your rights.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: true,
  audience: "everyone",
  sections: [
    {
      id: "scope",
      heading: "1. Scope",
      blocks: [
        { kind: "p", text: "This Privacy Policy explains how {{operatorName}} handles personal information in the hosted {{serviceName}} service. It applies to the account you create, the data you put into the Service, and the data the Service collects automatically as you use it." },
        { kind: "callout", tone: "info", title: "Self-hosted deployments", text: "If you run {{serviceName}} yourself, this policy does not describe your deployment. You are the operator and the controller of the data in it; you decide what is collected and how long it is kept, and you must publish your own privacy notice." },
        { kind: "p", text: "Where you use the Service to process information about your own customers, contacts, or employees, you are the controller and we act as your processor under the Data Processing Addendum. In that case, requests from those individuals should go to you first, and we will help you respond." },
      ],
    },
    {
      id: "collect",
      heading: "2. Information we collect",
      blocks: [
        { kind: "p", text: "We collect the following categories. This list is generated from the Service's own data model so it stays accurate as the product changes:" },
        { kind: "defs", items: [
          { term: "Account information", text: "Your name, email address, password hash, avatar, organization memberships and roles, and your settings." },
          { term: "Authentication and security data", text: "Session records (token hash, creation and refresh times), IP address and browser user agent recorded at sign-in, sign-in failures, audit-log entries for administrative and sensitive actions, and pending email tokens for password resets." },
          { term: "Business content you provide", text: "Companies, goals, projects, tasks, documents and their version history, company profile and playbooks, knowledge base content, finance and growth records, and any files you upload as artifacts." },
          { term: "Agent and automation records", text: "Conversations and messages, agent runs and steps, the plans agents produce, model calls and their prompts/responses as needed for the run, tool calls and their results, approvals and decisions, policies, budgets and ledger entries, and long-term memories with their vector embeddings." },
          { term: "Contact and marketing data", text: "Contacts, leads, campaigns, suppression records, and the outbound email, SMS and social messages sent on your behalf, including recipient, content, status, and provider message IDs." },
          { term: "Integration and credential data", text: "The third-party services you connect, their configuration, encrypted credentials and OAuth tokens, API keys and webhook endpoints you create, and the data those integrations return — for example email metadata and message bodies if you connect a mailbox." },
          { term: "Support and communications data", text: "Support tickets and their threads, and correspondence with us." },
          { term: "Technical data", text: "Request metadata needed to secure and operate the Service: request IDs, timestamps, route, response status, and rate-limit counters. A session cookie is used to keep you signed in." },
        ]},
        { kind: "p", text: "We do not buy personal information, we do not run advertising trackers or third-party analytics in the product, and we do not sell or share personal information for cross-context behavioral advertising." },
      ],
    },
    {
      id: "sources",
      heading: "3. Where the information comes from",
      blocks: [
        { kind: "list", items: [
          "From you, when you register, configure a company, type a message, upload a file, or approve an action.",
          "From your agents, which produce plans, memories, messages, and artifacts as they work on your instructions.",
          "From integrations you connect, which return data such as emails, calendar events, repository activity, payment records, or customer conversations.",
          "Automatically, as technical data when your browser or API client calls the Service.",
        ]},
      ],
    },
    {
      id: "why",
      heading: "4. Why we use it, and our legal bases",
      blocks: [
        { kind: "table", head: ["Purpose", "What it covers", "Legal basis (where GDPR/UK GDPR applies)"], rows: [
          ["Provide the Service", "Operating your account, running agents, storing and displaying your data, sending the messages you ask us to send", "Performance of a contract"],
          ["Keep it secure", "Authentication, session management, rate limiting, abuse and fraud prevention, audit logging, incident investigation", "Legitimate interests in keeping the Service secure and available"],
          ["Support you", "Answering your questions and debugging your issues", "Performance of a contract; legitimate interests"],
          ["Improve reliability", "Error diagnosis and aggregate usage metrics built from the operator's own logs", "Legitimate interests in running a reliable service"],
          ["Comply with law", "Responding to valid legal process, tax and accounting duties, honoring opt-outs", "Legal obligation"],
          ["Communicate service changes", "Security alerts, material policy changes, service notices", "Performance of a contract; legal obligation"],
          ["Optional marketing", "Product news, if you opt in", "Consent, which you can withdraw at any time"],
        ]},
        { kind: "p", text: "We do not use Your Data to train models of our own, and we do not sell it. Where a third-party model provider is configured, your content is sent to that provider only to fulfil your request, under your own agreement with them." },
      ],
    },
    {
      id: "google",
      heading: "5. Google user data (Limited Use disclosure)",
      blocks: [
        { kind: "p", text: "If you connect a Google account, {{serviceName}} requests access to Gmail and Google Calendar. Specifically, it can request:" },
        { kind: "list", items: [
          "gmail.readonly — to read the messages in the mailboxes you connect. This is a Google-restricted scope.",
          "gmail.send — to send replies or campaigns you instruct. This is a Google-sensitive scope.",
          "calendar access — to read and, if you enable it, create or modify events.",
          "basic profile information (email address and name) — to identify the connected account.",
        ]},
        { kind: "p", text: "How we use Google user data:" },
        { kind: "list", items: [
          "Gmail data is used only to provide and improve user-facing features you asked for: building the support-ticket and contact views you see, letting an agent draft or send a reply you authorized, and detecting the outcome of messages you sent. Read messages are stored in your deployment's database as part of your organization's data.",
          "Calendar data is used to display your schedule and to create or update events you ask for, subject to your approval settings.",
          "We do not use Google user data for advertising, we do not sell it, and we do not use it to train generalized AI/ML models or transfer it to third parties except as needed to provide the Service or as required by law. Access is limited to what the scopes above provide.",
          "Google user data is not read by humans except (i) with your explicit permission for support, (ii) for security purposes such as investigating abuse, or (iii) to comply with law. Automated processing by agents happens only on your instructions.",
          "Aggregated, de-identified information may be used for internal metrics, but never derived in a way that reveals your message content.",
          "Google user data is transmitted to a model provider only when a feature requires it to fulfil your instruction, and only to the provider you configured. If you do not want content leaving your deployment, configure a local model provider.",
        ]},
        { kind: "callout", tone: "info", title: "Google's Limited Use requirements", text: "Our use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. You can revoke access at any time from the app's integrations page or from your Google account's third-party access page." },
        { kind: "p", text: "The Service's use of Google user data is limited to the purposes above. If we ever want to use it for another purpose, we will ask you first." },
      ],
    },
    {
      id: "ai",
      heading: "6. AI processing",
      blocks: [
        { kind: "p", text: "Agents send the content needed for a task to the model provider you configure. That can include your instructions, retrieved memories, relevant business records, and tool results. Providers are chosen by you, and their retention and training practices are governed by your agreement with them." },
        { kind: "p", text: "Model calls, prompts, and responses are recorded in the run history so you have an audit trail of what your agents did. Embeddings for memory search are computed either by your configured provider or locally, depending on your configuration." },
        { kind: "p", text: "The Service does not make decisions with legal or similarly significant effects about individuals on its own initiative. Agents act only on your instructions and within your policies; where such a decision happens, you are the decision-maker and must provide the human review and safeguards the law requires." },
      ],
    },
    {
      id: "sharing",
      heading: "7. Who we share it with",
      blocks: [
        { kind: "list", items: [
          "Our subprocessors, listed on the Subprocessors page, which provide hosting, the database, transactional email, and operational tooling. Each is bound by a data-processing agreement and receives only what its function requires.",
          "Model and service providers you configure, to fulfil your instructions.",
          "Other members of your organization, according to their roles and your policies.",
          "Professional advisers and authorities where we are legally required to disclose, or where disclosure is necessary to establish, exercise, or defend legal claims, to protect someone's safety, or to prevent fraud.",
          "A successor entity if the project is ever transferred or reorganized; you would be notified and the new operator would remain bound by this policy.",
        ]},
        { kind: "p", text: "We do not sell personal information and we do not share it for cross-context behavioral advertising. If this ever changes, we will not do it without your opt-in consent where required." },
      ],
    },
    {
      id: "cookies",
      heading: "8. Cookies and local storage",
      blocks: [
        { kind: "p", text: "The Service sets one strictly necessary cookie to keep you signed in, and uses browser local storage for two preferences. There are no advertising or third-party analytics cookies at launch. The Cookie Notice lists each item, its purpose, and how to remove it." },
      ],
    },
    {
      id: "retention",
      heading: "9. How long we keep it",
      blocks: [
        { kind: "p", text: "Retention is defined per data category in the Retention Policy, with the actual window published in a table generated from the same configuration the Service enforces. Short-lived technical data such as expired sessions, used tokens, old activity events, and webhook delivery logs is deleted automatically on a schedule." },
        { kind: "p", text: "Two categories are deliberately longer-lived: the record of what your agents did, which is the audit trail the product exists to provide, and suppression records, which must survive deletion so an opt-out keeps being honored." },
      ],
    },
    {
      id: "rights",
      heading: "10. Your rights",
      blocks: [
        { kind: "p", text: "Depending on where you live, you may have some or all of these rights. We honor them for everyone who asks, to the extent the law requires:" },
        { kind: "table", head: ["Right", "What it means here", "How to exercise it"], rows: [
          ["Access / know", "A copy of the personal information associated with your account", "Export your data from the app, or ask us"],
          ["Portability", "A machine-readable archive of your organization's data", "Export from the app"],
          ["Correction", "Fix inaccurate account information", "Edit it in the app, or ask us"],
          ["Deletion", "Delete your account, or specific records such as memories, conversations, or contacts", "Delete from the app, or ask us"],
          ["Object / restrict", "Object to processing based on legitimate interests, or restrict it", "Ask us; we will explain any limits"],
          ["Withdraw consent", "Turn off optional marketing or revoke an integration", "Settings, or unsubscribe link in any email"],
          ["Non-discrimination", "You will not be penalized for exercising a right", "Not applicable — we do not do this"],
        ]},
        { kind: "p", text: "To make a request, use the in-app controls or contact {{contact}}. We may need to verify your identity, and we will respond within the time the law allows (45 days under California law, one month under GDPR, extendable where permitted). An authorized agent can act for you with written permission or a power of attorney; we may ask you to confirm the authorization directly." },
        { kind: "p", text: "If your request concerns data you hold about other people as a controller, we will refer you to the relevant organization and assist it in responding." },
      ],
    },
    {
      id: "security-practices",
      heading: "11. How we protect it",
      blocks: [
        { kind: "p", text: "Traffic is encrypted in transit, credentials and OAuth tokens are encrypted at rest with the deployment's master key, passwords are stored as hashes, sessions use httpOnly cookies with SameSite protection and CSRF checks on state-changing requests, and the API applies rate limits and audit logging. You can require approval for externally visible actions and cap spend with budgets." },
        { kind: "p", text: "Current limitations are published, not hidden: the threat model in the repository documents what is not yet implemented. Read the Security page for the honest current state, including what we do not yet have. No system is perfectly secure, and you should keep your own independent backups of anything you cannot afford to lose." },
      ],
    },
    {
      id: "children",
      heading: "12. Children",
      blocks: [
        { kind: "p", text: "The Service is a business tool and is not directed to children. You must be at least {{minimumAge}} to hold an account. We do not knowingly collect personal information from children under 13. If you believe a child has provided us personal information, contact {{contact}} and we will delete it. If we learn we have collected it, we will delete it and terminate the account." },
      ],
    },
    {
      id: "transfers",
      heading: "13. International transfers",
      blocks: [
        { kind: "p", text: "The Service is hosted in {{hostingRegion}}, and your data may be processed in other countries where our subprocessors operate, including the United States. Where personal data protected by GDPR or UK GDPR is transferred out of the EEA or the UK, we rely on the European Commission's Standard Contractual Clauses and the UK Addendum, supplemented by transfer impact assessments." },
        { kind: "p", text: "Business customers can execute the Data Processing Addendum, which incorporates the Standard Contractual Clauses by reference and lists the current subprocessors. If you have residency requirements, you can also self-host in your own region, in which case no transfer to us occurs at all." },
      ],
    },
    {
      id: "changes",
      heading: "14. Changes to this policy",
      blocks: [
        { kind: "p", text: "We version this policy. Material changes are announced in the app or by email before they take effect, and where the law requires your consent we ask for it. The version and effective date appear at the top of the page, and previous versions remain available in the repository's history so you can compare them." },
      ],
    },
    {
      id: "contact",
      heading: "15. Contact and complaints",
      blocks: [
        { kind: "p", text: "Privacy questions and requests: {{contact}}. If you are in the EEA or the UK, you have the right to complain to your local supervisory authority, and we would appreciate the chance to resolve the issue first. Where we act as your processor, please route individual requests to the organization that holds the account." },
        { kind: "p", text: "We do not currently have a data protection officer, because the project does not fall within the categories that require one. That may change, and this page will say so when it does." },
      ],
    },
  ],
};

const ACCEPTABLE_USE: LegalDocument = {
  slug: "acceptable-use",
  title: "Acceptable Use Policy",
  summary: "What you may and may not do with {{serviceName}} — especially with agents that can act outside your account.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: true,
  audience: "everyone",
  sections: [
    {
      id: "purpose",
      heading: "1. Why this policy exists",
      blocks: [
        { kind: "p", text: "{{serviceName}} agents can send email, post publicly, change code, and touch other people's systems. That makes misuse more consequential than in an ordinary SaaS tool, so this policy sets clear limits. It applies to you and to anything your agents do under your account." },
        { kind: "p", text: "Breaching this policy is a breach of the Terms of Service and can lead to suspension or termination." },
      ],
    },
    {
      id: "prohibited",
      heading: "2. Prohibited uses",
      blocks: [
        { kind: "p", text: "You must not use the Service, or let your agents act, to:" },
        { kind: "list", items: [
          "Send spam, unsolicited bulk messages, or messages to recipients you have no lawful basis to contact, or that violate CAN-SPAM, the TCPA, GDPR's e-marketing rules, or equivalent law.",
          "Send SMS or make automated calls without the consent the law requires, or continue contacting anyone who has opted out or replied STOP.",
          "Commit fraud, phishing, impersonation, or deception — including presenting agent output as human work, or hiding that a message came from an AI system when the recipient is entitled to know.",
          "Harass, threaten, stalk, or abuse anyone, or create content that sexualizes minors or incites violence.",
          "Use unlawful surveillance, or process data about people who have not been told, where the law requires notice or consent.",
          "Access systems, accounts, or data without authorization, or use agents to scan, probe, or exploit a third party without written permission.",
          "Create, distribute, or deploy malware, ransomware, or destructive code, or run a botnet or proxy network.",
          "Abuse credentials: buy, sell, share, or use stolen keys, tokens, or accounts, or evade a provider's rate limits or terms.",
          "Infringe intellectual property, violate database or publicity rights, or reproduce protected material you have no right to use.",
          "Break the terms of a service you connect — config scrape a site that forbids it, relay mail through a provider that prohibits it, or otherwise use an integration against its own rules.",
        ]},
      ],
    },
    {
      id: "agent-controls",
      heading: "3. Do not defeat the safety controls",
      blocks: [
        { kind: "p", text: "The Service ships with approvals, autonomy limits, budgets, policy dimensions, rate caps, and a suppression list. These are safety features, and working around them is prohibited. In particular you must not:" },
        { kind: "list", items: [
          "Manipulate prompts or data to bypass a required approval, or to make an agent take an action a policy forbids.",
          "Disable, inflate, or evade budget and rate limits to keep sending after a stop.",
          "Attempt prompt injection against another tenant, or try to reach data belonging to an organization you are not a member of.",
          "Use the companion app or agent tooling to escalate privileges, exfiltrate secrets, or run commands that the policy layer would have blocked.",
          "Solicit an agent's assistance to commit any act prohibited in these documents, including by using the local companion to operate outside the Service's controls.",
          "Report a vulnerability without giving us a reasonable opportunity to fix it, or use one for anything other than good-faith testing within the scope you were authorized for.",
        ]},
      ],
    },
    {
      id: "high-impact",
      heading: "4. High-impact and regulated uses",
      blocks: [
        { kind: "p", text: "Some uses need extra care because harm from an error is serious. If you use the Service for these, a qualified human must review the output before it is relied on or acted upon, and you are responsible for complying with the sector rules that apply to you:" },
        { kind: "list", items: [
          "Decisions about individuals (employment, credit, housing, insurance, education, or access to essential services). The Service must not be used to make such decisions automatically, and human review plus the notices the law requires are your responsibility.",
          "Medical, legal, tax, accounting, or financial advice given to third parties.",
          "Anything touching patient data, or personal data requiring a specific lawful basis such as health or biometric data.",
          "Managing critical infrastructure or systems whose failure could endanger people.",
          "Communications to people who are vulnerable, or to a large audience where a mistake could cause material harm.",
        ]},
      ],
    },
    {
      id: "content-rules",
      heading: "5. Content and conduct standards",
      blocks: [
        { kind: "list", items: [
          "Do not upload content you have no right to use, or that contains another person's confidential information without authority.",
          "Do not use the Service to build a competing dataset from someone else's data you obtained unlawfully.",
          "Do not represent that the Service or its outputs are certified, audited, or approved by anyone when they are not.",
          "Do not misrepresent your affiliation with {{serviceName}} or use its marks without permission.",
        ]},
      ],
    },
    {
      id: "reporting",
      heading: "6. Reporting abuse",
      blocks: [
        { kind: "p", text: "Report abuse, spam sent through the Service, or a security problem to {{contact}}. Include the sender, the organization, and the evidence you have. We aim to acknowledge security reports within three business days and will act on credible reports of unlawful sending by restricting the account's ability to send." },
        { kind: "p", text: "If you received email from a {{serviceName}} user and want to stop receiving it, use the unsubscribe link in the message — it adds you to the sender's suppression list, and the Service blocks further marketing sends to that address." },
      ],
    },
    {
      id: "enforcement",
      heading: "7. How we enforce this policy",
      blocks: [
        { kind: "p", text: "Enforcement is proportionate and, where practical, graduated:" },
        { kind: "list", ordered: true, items: [
          "Notice: we contact you to explain the problem and ask for a fix, with a deadline.",
          "Restriction: we throttle or block specific capabilities, such as outbound sending or a particular integration.",
          "Suspension: we suspend access to the Service while we investigate, if the conduct is ongoing or risks others.",
          "Termination: we terminate the account for serious or repeated breaches, for unlawful conduct, or where we are legally required to.",
        ]},
        { kind: "p", text: "We may act immediately without the graduated steps where delay would cause harm, expose others' data, or assist ongoing illegality. You can appeal a restriction by replying to our notice; we review appeals in good faith." },
      ],
    },
  ],
};

const AI_TERMS: LegalDocument = {
  slug: "ai-terms",
  title: "AI and Autonomous Agent Terms",
  summary: "How {{serviceName}}'s agents are supposed to be used, what they can get wrong, and where responsibility sits.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "what-agents-are",
      heading: "1. What the agents are",
      blocks: [
        { kind: "p", text: "{{serviceName}} agents are software that plans and executes work using large language models and tools. They are not employees, advisers, or fiduciaries. They do not exercise professional judgment, and they do not have authority beyond what you configure." },
      ],
    },
    {
      id: "accuracy",
      heading: "2. Outputs can be wrong",
      blocks: [
        { kind: "p", text: "Model outputs can be inaccurate, incomplete, outdated, or fabricated. They can contain confidently stated errors — wrong figures, invented sources, plausible-looking code that does not run. Agents can also be influenced by content they read: a web page, an email, or a document can contain instructions that try to redirect an agent (prompt injection). The Service treats third-party content as untrusted data and requires approval for high-risk actions, but no design eliminates the risk." },
        { kind: "p", text: "You must verify anything material. Outputs are drafts, not verdicts." },
      ],
    },
    {
      id: "responsibility",
      heading: "3. Where responsibility sits",
      blocks: [
        { kind: "list", items: [
          "You authorize the instructions you give and the approvals you grant. They are your acts.",
          "You choose the autonomy level. A higher level means less human review, not less responsibility.",
          "You choose the provider, the model, the tools, and the integrations. Their failures and limits are yours to plan for.",
          "You are the decision-maker for any decision about a person. Do not delegate such a decision to an agent.",
          "You must comply with the rules of every service your agents touch, and with the law where your recipients and customers are.",
        ]},
        { kind: "callout", tone: "warn", title: "Authority to act", text: "By instructing an agent to act on an account, mailbox, phone number, repository, or payment system, you confirm you are authorized to do so and that you may lawfully let software act on it." },
      ],
    },
    {
      id: "disclosure",
      heading: "4. Telling people they are dealing with AI",
      blocks: [
        { kind: "p", text: "People who interact with an agent are entitled to know it is an AI system rather than a person. Where a law requires disclosure — for example Article 50 of the EU AI Act for systems that interact directly with natural persons — the obligation is yours, and you must not disable or obscure the disclosure the Service provides." },
        { kind: "p", text: "The Service can append an AI disclosure to outbound email and messages sent by agents. It is a setting you control. Turning it off is allowed only where disclosure is not required or where the message is clearly produced by your organization and a human reviews and sends it." },
        { kind: "p", text: "Do not present an agent as a human, as a licensed professional, or as having qualifications it does not have. Do not use an agent to conduct interviews, negotiations, or counselling in a way that misleads the other person about who they are speaking to." },
      ],
    },
    {
      id: "data-flows",
      heading: "5. Where your data goes when an agent runs",
      blocks: [
        { kind: "list", items: [
          "The model provider you configured receives the prompt: your instruction, retrieved memories, relevant records, and tool results needed for the task.",
          "Connected services receive the calls the agent makes — for example a tool that reads a mailbox or posts to a channel.",
          "Whatever is needed to produce the run's audit trail is stored in your deployment: the plan, model calls, tool calls, decisions, artifacts, and cost.",
          "If you use a local model runtime (such as a self-hosted Ollama endpoint), prompts can stay inside your own network. That choice is yours.",
        ]},
      ],
    },
    {
      id: "autonomy",
      heading: "6. Autonomy levels, approvals, and budgets",
      blocks: [
        { kind: "table", head: ["Level", "What agents may do without asking", "What you should assume"], rows: [
          ["0 — Observe", "Read and analyze only", "No external side effects"],
          ["1 — Suggest", "Draft proposals and artifacts", "Nothing is sent or published without you"],
          ["2 — Act with approval", "Nothing externally visible without approval", "Each external action was authorized by a human decision"],
          ["3 — Act within policy", "Approved action types proceed within your policies and budgets", "Review the audit trail; individual actions were not pre-approved by a person"],
          ["4 — Autonomous within hard limits", "Acts broadly inside hard limits and required approvals", "Highest exposure: agents can act unattended. Monitor runs and results closely"],
        ]},
        { kind: "p", text: "Critical actions — payments, production deploys, sending to external parties, and destructive operations — are designed to always require human approval regardless of level." },
      ],
    },
    {
      id: "high-impact-ai",
      heading: "7. Prohibited AI uses",
      blocks: [
        { kind: "list", items: [
          "Using the Service to make decisions about individuals without human review where the law requires it.",
          "Using the Service for social scoring, real-time biometric identification in public spaces, emotion inference in workplaces or schools, or manipulative techniques that exploit vulnerability.",
          "Generating content that sexualizes minors, incites violence, or spreads disinformation intended to cause harm.",
          "Using the Service to develop prohibited AI practices under the EU AI Act or equivalent laws.",
        ]},
      ],
    },
    {
      id: "changes-ai",
      heading: "8. Changes and limitations",
      blocks: [
        { kind: "p", text: "Models change without notice, providers deprecate them, and capabilities shift. The Service records which model was used for each run so you can trace behaviour. We do not guarantee that an agent will behave identically over time, and we recommend testing changes to your configuration before widening autonomy." },
      ],
    },
  ],
};

const COOKIES: LegalDocument = {
  slug: "cookies",
  title: "Cookie Notice",
  summary: "The one cookie {{serviceName}} sets, the two browser preferences it stores, and what we do not use.",
  version: "1.0.0",
  effectiveDate: "2026-09-25",
  requiresAcceptance: false,
  audience: "everyone",
  sections: [
    {
      id: "what",
      heading: "1. Summary",
      blocks: [
        { kind: "p", text: "The hosted Service sets exactly one cookie. It is strictly necessary for authentication, it carries no advertising or analytics identifier, and it cannot be used to track you across other sites." },
      ],
    },
    {
      id: "table",
      heading: "2. Cookies we set",
      blocks: [
        { kind: "table", head: ["Name", "Type", "Purpose", "Details"], rows: [
          ["steward_session", "Strictly necessary", "Keeps you signed in and identifies your session to the API", "httpOnly, SameSite=Lax, Secure when the site is served over HTTPS, path=/, expires after 14 days (refreshed while you use the Service)"],
        ]},
        { kind: "p", text: "Signing out deletes the cookie and revokes the session server-side. Deleting it in your browser at any time logs you out." },
      ],
    },
    {
      id: "storage",
      heading: "3. Browser storage",
      blocks: [
        { kind: "table", head: ["Key", "Where", "Purpose"], rows: [
          ["steward-theme", "localStorage", "Remembers whether you chose light, dark, or system appearance so the page does not flash the wrong theme"],
          ["steward-onboarding", "localStorage", "Remembers that you dismissed onboarding hints"],
        ]},
        { kind: "p", text: "These are preferences, not identifiers. They stay on your device and are never sent to us as tracking data. You can clear them in your browser settings at any time." },
      ],
    },
    {
      id: "no-trackers",
      heading: "4. What we do not use",
      blocks: [
        { kind: "list", items: [
          "No advertising or retargeting cookies or pixels.",
          "No third-party analytics, session-recording, heatmap, or A/B testing scripts at launch.",
          "No cross-site tracking, fingerprinting, or selling of cookie-derived data.",
        ]},
        { kind: "p", text: "If we add anything in the non-essential categories, we will publish it here first and ask for consent where the law requires it (UK PECR and EU ePrivacy rules require consent before non-essential cookies are set)." },
      ],
    },
    {
      id: "api",
      heading: "5. API and self-hosted use",
      blocks: [
        { kind: "p", text: "If you call the API with a bearer token instead of a browser session, no cookie is involved. If you self-host {{serviceName}}, your deployment sets the same session cookie for its own users, and any additional cookies or analytics you introduce are your responsibility." },
      ],
    },
  ],
};

export const CORE_DOCUMENTS: LegalDocument[] = [TERMS, PRIVACY, ACCEPTABLE_USE, AI_TERMS, COOKIES];
