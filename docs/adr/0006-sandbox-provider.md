# ADR-0006: Docker-based sandbox with pluggable providers

Status: Accepted

## Decision
`LocalDockerSandbox` via dockerode is the v1 provider: non-root user, cap-drop ALL, read-only root with tmpfs, memory/CPU/pid limits, per-run network policy (none/allowlist/full), no host bind mounts; the control-plane filesystem is never mounted. Optional gVisor runtime. `SandboxProvider` interface supports future Kubernetes/Firecracker/E2B providers.

## Consequences
Requires Docker socket access for the worker; production guidance uses a dedicated sandbox Docker host.
