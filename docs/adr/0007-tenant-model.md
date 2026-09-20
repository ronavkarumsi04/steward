# ADR-0007: User → Organization → Membership → Company tenant model

Status: Accepted

## Decision
Organizations own companies, credentials, billing, and API keys. Memberships carry roles (owner/admin/member/viewer). Company-scoped data always includes organization_id for defense in depth. Workflow inputs and activities carry and re-validate {orgId, companyId}.
