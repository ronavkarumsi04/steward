# Integrations

Integrations are connected per organization under **Integrations** and enabled per company. Credentials are encrypted at rest; tools call integrations through the framework so agents never see raw tokens. Each integration declares `status`:

- `implemented` — actions are implemented and exercised by tests against the provider's wire format; live behaviour still depends on your credentials.
- `framework` — catalog entry, auth flow, configuration and action definitions exist, but the actions have not been exercised against the live API and should be treated as unverified.

| Integration | Category | Auth | Status | Actions |
| --- | --- | --- | --- | --- |
| GitHub | source control | OAuth / PAT | implemented | `list_repos`, `read_file`, `create_branch`, `commit_files`, `create_pull_request`, `merge_pull_request`, `create_issue` |
| Slack | messaging | OAuth / bot token | implemented | `post_message`, `list_channels` |
| Discord | messaging | bot token | implemented | `post_message` |
| Twilio | messaging | account SID + token | implemented | `send_sms` |
| X | social | OAuth 2 | implemented | `me`, `publish_post` |
| LinkedIn | social | OAuth 2 | framework | `publish_post` (defined, unverified) |
| Resend / Postmark / SendGrid / SMTP | email | API key / SMTP | implemented | `send_email` |
| Stripe | business | restricted API key | implemented | `read_metrics`, `create_product`, `create_checkout_session` (money-moving actions require approval) |
| Neon | database | API key | implemented | `list_projects`, `create_project` |
| Supabase | database | API key | framework | — |
| Vercel | deploy | token | implemented | `list_projects`, `create_project`, `deploy_preview`, `deploy_production`, `set_env`, `list_domains`, `add_domain`, `verify_domain` |
| Render | deploy | API key | implemented | `list_services`, `create_service`, `deploy` |
| Google | productivity | OAuth 2 | implemented | `list_messages`, `send_email` (Gmail), `create_event` (Calendar) |
| HubSpot | CRM | OAuth 2 | framework | `search_contacts`, `upsert_contact` (defined, unverified) |
| Notion | knowledge | OAuth 2 | framework | `search`, `create_page` (defined, unverified) |
| Generic REST | any | header/bearer/basic | implemented | `request_read`, `request_write` against an allow-listed base URL |

## OAuth

Set the client ID/secret for a provider via environment (`<PROVIDER>_OAUTH_CLIENT_ID/SECRET`); the callback URL is `${API_URL}/v1/integrations/oauth/<provider>/callback`. The API stores state server-side and encrypts refresh tokens.

## Risk classification

Every integration action is classified `low | medium | high | critical` in `packages/policy`. Critical actions (payments, production deploys, deleting resources, sending to external recipients at autonomy < 4) create an approval that pauses the run until a human decides in **Approvals**.
