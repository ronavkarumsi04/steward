# Administrative and Employee Access Policy

Steward can hold a business's most sensitive data — customer lists, email content, financial records,
credentials. Access to production must therefore be **rare, deliberate, logged, and time-limited**, not a
side effect of having a laptop.

## 1. Principles

1. **Least privilege.** Access is granted for a task, not to a person by default.
2. **No standing access to customer content.** Reading tenant data is the exception requiring a reason,
   not a baseline.
3. **Every access is attributable.** Shared production credentials are prohibited; each maintainer has
   their own.
4. **Customer-facing is never the default path.** Support answers questions using the customer's own
   exports and screenshots where possible.

## 2. Roles

| Role | What they can reach | Requirements |
| --- | --- | --- |
| Maintainer (contributor) | Source code, local deployments, their own data | Nothing beyond a GitHub account |
| Production operator | Deployment environment variables, logs, database connection, provider dashboards | Explicit grant from an existing operator, second-person approval, unique credentials |
| Privacy contact | `privacy_requests`, customer correspondence | Same as production operator, appointed as the named contact in the DPA |

An operator leaving the project must be removed from every provider within **7 days**, and the deployment
master key must be rotated if they could read it (see `INCIDENT_RESPONSE.md` §6).

## 3. What operators may never do

- Copy customer data out of production (no local dumps, no test fixtures built from real records).
- Read customer message content, artifacts, or CRM data without a documented reason.
- Use production credentials from a shared or personal environment file without rotation afterwards.
- Give a customer's data to another customer, an investor, a demo, or an AI tool.
- Access data to answer a request that should be routed through `privacy_requests` or the law-enforcement
  procedure.

## 4. Access to Google user data

Gmail data can arrive through a customer-connected Google account. Google's API Services User Data Policy
restricts human access to that data, and Steward enforces this by policy:

- Google user data may only be read by a human **with the customer's explicit permission** (usually for
  support), for **security purposes** (malware, abuse, or an incident), or **where the law requires it**.
- Support access must be requested by the customer in writing, and the incident or ticket must be logged.
- Bulk reads, exports, or searches of Gmail content are prohibited, including for debugging — reproduce with
  synthetic data instead.
- Anything read under this exception may not be used for any other purpose, shared, or retained beyond the
  ticket.
- Customers can revoke access unilaterally; a revoked grant must not be re-requested by support.

The same discipline applies to every connected integration: read what the ticket needs, nothing more.

## 5. Break-glass access

Emergencies may require access outside the normal path (for example, the database is down and only the
operator can reach it).

1. Announce in the maintainer channel what you are doing and why, before or immediately after acting.
2. Take the minimum action to restore service or stop harm.
3. Record the details in the incident log afterwards: what you accessed, when, why, and who authorized it.
4. If customer content had to be read, notify the affected customer when the incident is resolved.

Break-glass is not a shortcut around section 3; it is a documented exception with a short half-life.

## 6. Auditability

- Administrative and sensitive actions in the product write to `audit_log` with actor, target, and IP.
- Provider dashboards (Vercel, database, Temporal, email) require unique accounts with 2FA enabled. Where a
  provider supports access logs, review them after any incident.
- Review operator access quarterly: who has it, whether it is still needed, whether any credential was shared.
  Record the review outcome in `VENDOR_REGISTER.md`.

## 7. Support tooling

There is deliberately **no customer-impersonation feature** in the product: no "sign in as this user"
button, no master key that decrypts everything for support. Recovering an account is done by email
verification, not by impersonation. That is a design constraint to protect customers, not a missing feature.
