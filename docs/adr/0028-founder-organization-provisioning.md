# ADR-0028: Instance operators provision founder organizations without membership

Status: Accepted.

## Context

Inviting a founder as an owner into an operator-created organization leaves the operator as a
second owner until they explicitly leave. Ordinary team invitations also permit granting ownership,
conflating teammate onboarding with provisioning a founder's independent organization. Invite-only
instances need to onboard both new and existing founders without requiring working email delivery.

## Decision

- Instance operators provision a memberless organization and an owner-role invitation in one
  transaction, with an `organization.provisioned` audit record identifying the intended owner email.
  The operator is never added as a member. Shared slug creation logic serves personal and provisioned
  organizations.
- Ordinary invitations cannot grant owner access, including when issued by a superadmin. Existing
  member role changes are unchanged. Accepting the provisioning invitation through registration or
  the signed-in invite page makes the founder the organization's sole initial owner.
- The superadmin-only operator API returns an accept URL even if email delivery fails. A server-side
  CLI uses the same core provisioning path, prints an APP_URL-based link without sending email, and
  needs neither a superadmin session nor superadmin grant tooling.
- Superadmins retain instance-wide read access and existing administrative privileges without
  organization membership. Membership separation is not a security boundary against instance operators.

## Alternatives considered

- Create an organization as the operator, invite an owner, then leave: requires an extra cleanup step
  and temporarily grants the operator membership that independent founder onboarding does not need.
- Keep owner-role team invitations: makes it easy to confuse team onboarding with independent
  ownership provisioning and does not establish a memberless handoff.
- Require emailed invitations: blocks onboarding when transactional mail is unavailable; returning
  and printing the single-use link supports a secure manual handoff instead.

## Consequences

- Founders can become sole owners under closed signup without operator membership cleanup.
- An unaccepted provisioning invitation leaves an organization with no members; the operator must
  hand over its link within the invitation's expiry window.
- Printed and returned invitation links are sensitive bearer credentials and must be shared securely.
- Provisioning requires server access or a superadmin session, while normal team invitations remain
  available to organization admins. Deployment instructions live in [DEPLOY.md](../DEPLOY.md#provisioning-a-founders-own-organization).
