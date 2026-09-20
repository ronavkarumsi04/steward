# Integration Matrix

Research date: 2026-09-20. "Externally visible" = the integration can perform an action a third party can
see (send, publish, deploy, charge). "Approval" is Steward's default policy at autonomy level 2 (Approval
Required); levels 3–4 may pre-authorize LOW/MEDIUM categories.

Status legend for Steward v1:
- **implemented**: real adapter + contract tests; live verification needs credentials.
- **framework**: OAuth/API connection path implemented through the generic connector; tool surface minimal.
- **planned**: catalog entry only, shown as "unavailable" in UI.

| Integration | Official API | Auth | Scopes (least privilege) | Rate limits | Webhooks | Local dev strategy | Production strategy | ToS / licensing constraints | Externally visible actions | Approval default | Steward v1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GitHub | REST/GraphQL | GitHub App (installation token) or OAuth App; PAT for self-host | `contents:write`, `pull_requests:write`, `metadata:read`, `issues:write` | 5k req/h per installation; secondary limits | yes (HMAC-SHA256 `X-Hub-Signature-256`) | PAT to a test repo; recorded fixtures | GitHub App with per-org installation | GitHub ToS; automated activity must be attributable | create branch/commit/PR/issue (MEDIUM) | auto at L3+, approval at L2 | implemented |
| GitLab | REST v4 | OAuth2 / PAT | `api`, `write_repository` | 2k req/min (gitlab.com) | yes (secret token header) | PAT | OAuth2 app | GitLab ToS | MR/commit (MEDIUM) | same | framework |
| Google (identity) | OAuth 2.0 / OIDC | OAuth | `openid email profile` | n/a | n/a | OAuth client on localhost | Verified OAuth app (sensitive scopes review) | Google API Services User Data Policy | none | n/a | implemented |
| Gmail | Gmail API | OAuth (refresh token) | `gmail.readonly`, `gmail.send`, `gmail.modify` (only if drafts) | 250 quota units/s/user | push via Pub/Sub (`users.watch`) | test account + fixtures | verified app, restricted-scope review required | Restricted scopes: CASA assessment for public apps | send email (HIGH) | approval | implemented (send/read/draft) |
| Google Calendar | Calendar API | OAuth | `calendar.events` | 1M queries/day default | push channels | fixtures | verified app | Google policy | create/modify events (MEDIUM) | approval | framework |
| Microsoft (identity) | Entra ID OAuth 2.0 | OAuth | `openid profile email offline_access` | n/a | n/a | app registration | multi-tenant app | Microsoft APIs ToS | none | n/a | framework |
| Outlook Mail | Microsoft Graph | OAuth | `Mail.Read`, `Mail.Send` | Graph throttling per app/tenant | Graph change notifications | fixtures | admin consent flows | Microsoft ToS | send (HIGH) | approval | framework |
| Microsoft Calendar | Microsoft Graph | OAuth | `Calendars.ReadWrite` | throttling | change notifications | fixtures | same | same | events (MEDIUM) | approval | framework |
| Stripe | REST | Restricted API key (read) or Stripe Connect OAuth | Restricted key: `read` on charges/customers/subscriptions/balance | 100 req/s live | yes (`Stripe-Signature`, timestamp tolerance) | test mode keys + Stripe CLI | restricted keys per company | Stripe Services Agreement | create checkout/products (HIGH); refunds/payouts (CRITICAL, disabled) | approval | implemented (read metrics, checkout session, webhooks) |
| X (Twitter) | API v2 | OAuth 2.0 PKCE (user context) | `tweet.read tweet.write users.read offline.access` | tier-based (Basic: 100 posts/24h app) | Account Activity API (paid) | fixtures | paid API tier required | X Developer Agreement (automation rules) | publish post (HIGH) | approval | implemented (publish/draft) |
| Meta (Facebook/Instagram/Ads) | Graph API / Marketing API | OAuth (Facebook Login for Business) | `pages_manage_posts`, `instagram_content_publish`, `ads_management` (App Review) | BUC rate limiting | yes (app secret proof + signature) | test app/sandbox ad account | App Review + Business Verification | Platform Terms; ads policies | publish (HIGH), ads spend (CRITICAL) | approval | framework (ads: planned) |
| LinkedIn | Marketing/Community Mgmt APIs | OAuth 2.0 | `w_member_social`, `r_liteprofile`/`openid` | tiered | limited | fixtures | partner program for many endpoints | LinkedIn API ToS (restricted access) | publish post (HIGH) | approval | framework (member posting only) |
| Twilio | REST | Account SID + Auth Token / API key | none (key scoped by account) | per-number | yes (signature `X-Twilio-Signature`) | test credentials/magic numbers | sub-accounts | Twilio AUP; A2P 10DLC | SMS (HIGH) | approval | implemented (send SMS) |
| Slack | Web API + Events | OAuth v2 bot token | `chat:write`, `channels:read` | tiered per method | Events API (signing secret) | test workspace | Slack app distribution | Slack API ToS | post message (MEDIUM/HIGH) | auto at L3 for internal channel | implemented (post message, incoming webhook) |
| Discord | REST + Webhooks | Bot token / webhook URL | `SEND_MESSAGES` | 50 req/s global | interactions endpoint (Ed25519) | test server | bot install | Discord Developer ToS | post (MEDIUM) | auto at L3 | implemented (webhook post) |
| Resend | REST | API key | domain-scoped key | 10 req/s default | yes (Svix signatures) | test API key (`resend.dev` sandbox) | per-company key | Resend AUP | send email (HIGH) | approval | implemented |
| Postmark | REST | Server token (send-only) | server token ≠ account token (lesson from Polsia incident) | 10 msgs/batch call; per-server | yes (basic auth/IP allowlist) | sandbox server | server token per company | Postmark AUP | send (HIGH) | approval | implemented |
| SendGrid | REST v3 | API key (restricted: Mail Send) | `mail.send` | 600 req/min/endpoint | yes (ECDSA signed events) | sandbox mode flag | restricted key | Twilio SendGrid AUP | send (HIGH) | approval | implemented |
| HubSpot | CRM v3 | OAuth 2.0 / private app token | `crm.objects.contacts.read/write`, `crm.objects.deals.*` | 100 req/10s | yes (signature v3) | developer test account | OAuth app | HubSpot API terms | modify CRM (HIGH) | approval | framework (contacts/deals) |
| Salesforce | REST | OAuth 2.0 (web server / JWT) | `api refresh_token` | daily API allocation | Platform events / outbound messages | Developer Edition org | connected app | Salesforce terms | modify records (HIGH) | approval | planned |
| Notion | REST | OAuth (public integration) / internal token | page/database access grants | 3 req/s | limited | internal integration token | public integration | Notion terms | create pages (MEDIUM) | auto at L3 | framework |
| Google Drive | Drive API | OAuth | `drive.file` | per-user quotas | push | fixtures | verified app | Google policy | create files (MEDIUM) | auto at L3 | framework |
| Dropbox | HTTP API v2 | OAuth 2.0 | `files.content.write` | per-user | webhooks | app console | app approval for production | Dropbox terms | write files (MEDIUM) | auto at L3 | planned |
| Vercel | REST | Bearer token / integration OAuth | project-scoped token | 100s/min tiers | deployment webhooks (HMAC) | personal token + test project | integration | Vercel ToS | deploy (MEDIUM preview / HIGH production) | preview auto at L3; prod approval | implemented |
| Render | REST v1 | Bearer API key | account key | 400 req/min | webhooks (limited) | free service | API key per workspace | Render ToS | deploy (MEDIUM/HIGH) | as above | implemented |
| Railway | GraphQL v2 | Bearer token (account/project) | project token | per-token | webhooks (project) | test project | project tokens | Railway ToS | deploy | as above | framework |
| Fly.io | Machines API | Bearer (deploy token) | app-scoped deploy token | per-org | none | test app | deploy tokens | Fly ToS | deploy | as above | framework |
| Cloudflare | REST v4 | API token (scoped) | `Workers Scripts:Edit`, `Pages:Edit`, `DNS:Edit` | 1200 req/5min | limited | test zone | scoped tokens | Cloudflare ToS | deploy/DNS (HIGH) | approval | framework |
| Neon | REST v2 | API key | org/project key | per-key | none | free project | project-scoped keys | Neon ToS | create DB (MEDIUM) | auto at L3 | implemented |
| Supabase | Management API | PAT | org access | per-key | database webhooks | free project | PAT | Supabase ToS | create project (MEDIUM/HIGH cost) | approval | framework |
| AWS | SDK v3 | IAM access key / role | per-service policies | per-service | EventBridge | LocalStack | IAM roles | AWS agreement | infra (HIGH/CRITICAL) | approval | planned (Bedrock only in v1) |
| Google Cloud | SDKs | service account / ADC | per-API roles | per-API | Pub/Sub | emulators | workload identity | GCP terms | infra | approval | planned (Vertex only in v1) |
| Azure | SDKs | Entra | RBAC roles | per-API | Event Grid | none | managed identity | Azure terms | infra | approval | planned (Azure OpenAI only in v1) |
| Generic REST connector | any | header/basic/bearer/oauth2 | configured | configured | inbound generic webhook | mock server | user-configured | user's | configured risk | per tool config | implemented |
| MCP servers | MCP (stdio/HTTP streamable) | per server | per server | n/a | n/a | local servers | remote HTTP servers | per server | tool risk annotated per tool | configured | implemented |
| Outbound webhooks | HTTP | HMAC-SHA256 signature | n/a | n/a | this IS the webhook | local receiver | user endpoints | n/a | yes (LOW/MEDIUM) | auto | implemented |

## Cross-cutting rules

- All OAuth flows use `state` (signed, single-use, 10-min TTL) and PKCE where supported.
- Callback URLs are exact-match registered; tokens encrypted; refresh handled centrally
  (`OAuthTokenManager`) with jitter and revocation detection (401 → `integration.needs_reauth` event).
- Inbound webhooks: signature verification + timestamp tolerance + replay cache (`webhook_deliveries`
  unique on provider + delivery id).
- Outbound safety: hourly/daily caps per company, suppression list, duplicate-recipient prevention,
  kill switch (`company.outbound_paused`).
- SSRF: `web_fetch` and generic REST connector resolve DNS and reject private/link-local/loopback ranges
  unless an operator allowlist explicitly permits them.
