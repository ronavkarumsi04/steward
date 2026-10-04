# Free hosting qualification

Constraint confirmed by the owner on 2026-10-04: free-only hosting, BYOK inference, no new paid services.
This document records provider evidence and deployment gates, not a deployed or qualified topology.

## Candidate and rejected services

Provider documents fetched on 2026-10-04:

| Service | Verified published constraint | Decision |
| --- | --- | --- |
| [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | The current A1 allocation is 1,500 OCPU-hours and 9,000 GB-hours/month, equivalent to 2 OCPUs / 12 GB, plus up to 200 GB combined boot/block storage. Capacity can be unavailable; idle VMs can be reclaimed. | Candidate for a small beta. Account approval, actual allocation and workload qualification are required. Older 4-OCPU / 24-GB advice is not the source for this plan. |
| [Render Free](https://render.com/docs/free) | Free web services sleep after 15 minutes without inbound traffic, lose local filesystem changes on restart/redeploy, and do not provide a free background worker. The provider advises against production use. | Reject as the persistent worker/Temporal host. |
| [Koyeb Free](https://www.koyeb.com/docs/reference/instances) | One free instance, 512 MB RAM, 0.1 vCPU, 2 GB SSD; no worker service or persistent volume; sleeps after one hour without traffic. The provider advises against production use. | Reject as the persistent worker/Temporal host. |
| [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Restricted to non-commercial personal use. | Keep the existing deployment for development verification; do not call Hobby a free commercial-launch entitlement. Inspect the actual team plan before launch. |

Oracle [signup requirements](https://www.oracle.com/cloud/free/) include card verification. The owner must
complete that account action. Do not upgrade to Pay As You Go, use expiring trial resources, provision paid
shapes, or create artificial load to evade idle reclamation. Published allowances must be checked against
the actual tenancy and console's Always Free eligibility before provisioning.

## Proposed topology

On an allocated Always Free VM, run web, API, worker and private Temporal with persistent Temporal storage.
Keep the existing Supabase application database if its actual plan/capacity supports the beta; do not migrate
production data just to obtain access to secrets. Expose only HTTPS application traffic and restricted
administration. Temporal, its database and worker readiness must stay private. Use a controlled hostname
with valid TLS; a free VM does not provide an owned domain or DNS authorization.

Alternatively, keep Vercel web if the existing plan is already eligible for commercial use; the API and
Temporal can still share the VM's private network. [Worker deployment](WORKER_DEPLOYMENT.md) describes
both routing choices. The legacy backend Compose profile mounts the host Docker socket and enables startup
migrations; it is not the safe production manifest for this topology.

One host is a failure domain, not high availability. The 2-OCPU allocation needs measured concurrency,
off-host backups and a restore drill. Agent-built source execution and browser sessions need a reviewed
isolated runtime with enforced egress; do not mount the application host's Docker socket into the worker
or enable unsafe private-network browsing to complete a demo. A free VM alone does not finish the website loop.

## Required evidence before enabling execution

1. Owner account approval and actual Always Free allocation, with no paid entitlement or expiring credit dependency.
2. Native ARM64 worker/Temporal/browser compatibility and image boot if using A1. Local x86 tests are not ARM verification.
3. Private production Temporal, persistent schema/persistence lifecycle, health, namespace/queue agreement and restart recovery.
4. Original API encryption keys and application-role database credentials bound through secure hosting settings.
   Existing sensitive Vercel variables cannot be exported through the connected API; never replace the master key to gain access.
5. Valid HTTPS, same-origin session behavior and exact deployed source; appropriate Vercel entitlement or self-hosted web.
6. Hosted readiness, real metered BYOK generation/tool use, cancellation, failure recovery and bounded capacity.
7. Durable artifact storage, isolated source/browser execution and the founder-to-website loop.
8. Off-host backups, secret recovery, a restore drill and an observed stability window despite free-tier reclamation risk.

No Oracle VM, production Temporal or ARM image has been provisioned or qualified at this checkpoint.
Account/capacity denial means hosting remains blocked; it does not justify sleeping services, ephemeral
coding workspaces or fabricated readiness. A home server the owner already operates is another possible
free-compute route, but power, networking, TLS, backups and security still need qualification.

## NVIDIA qualification

The public `https://integrate.api.nvidia.com/v1/models` endpoint was fetched without credentials on
2026-10-04 and returned 81 model IDs, including `deepseek-ai/deepseek-v4.1-flash` and `z-ai/glm-5.3-flash`.
These IDs exist in discovery; this does not establish inference access, tool support, price, latency or quality.
The owner's saved NVIDIA credentials remain encrypted. Database metadata shows three enabled credentials
with legacy `verified` statuses, but those checks only queried the public catalog.

The local correction reports `catalog_only`, clears credential-verification timestamps for subsequent
catalog checks, and presents legacy NVIDIA checks honestly without rewriting production rows. Discovery
does not make hidden, unmetered inference calls. Qualify each candidate through the actual scoped gateway
and worker, with company budget, usage rows, tool-call round trip, structured output where needed, failure
handling and latency evidence. Start with a provisional DeepSeek Flash candidate; retain GLM Flash as a
comparison candidate. No production routing preference was changed and neither is approved as a verified
default yet. Provider free credits and limits are independent of the hosting budget.

## Publication blocker

Current GitHub main was re-read at `e34bd0e7f059a366b16f732c7ed3cae91ef024b4` on 2026-10-04.
Composio `GITHUB_CREATE_BRANCH` still rejected the review branch for unsupported Enhanced Controls,
despite the owner reporting the setting is off and the feature is temporarily disabled. Stop GitHub writes;
do not switch tool variants to evade it. Connector repair or a client supporting its elicitation is required.
Composio's feedback endpoint also failed to find the rejected execution, so no submitted support report is claimed.
