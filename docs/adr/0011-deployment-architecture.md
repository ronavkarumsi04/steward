# ADR-0011: Docker Compose first, containers everywhere

Status: Accepted

## Decision
Three application images (web, api, worker) plus Postgres, Redis, Temporal. Single `docker compose up` for dev and single-node prod; production notes cover external managed services and KMS. Kubernetes manifests deferred.
