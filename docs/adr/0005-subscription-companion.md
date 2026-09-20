# ADR-0005: Subscription-backed inference only via official, permitted local clients

Status: Accepted

## Context
Anthropic's legal docs prohibit third parties from routing Claude.ai Free/Pro/Max credentials on behalf of users; the Agent SDK subscription program is paused (2026-06-15). OpenAI's Codex CLI/SDK is designed to be embedded and honors ChatGPT sign-in on the user's machine.

## Decision
Implement `apps/companion`, a daemon on the user's machine that runs the official Codex SDK/CLI with the user's own login. Credentials never leave the machine. The companion exposes a restricted command protocol (codex.exec, codex.status, ping) over a mutually authenticated WebSocket with device pairing and revocation. Anthropic/Gemini subscription runners exist behind operator flags defaulting to off and require confirmed authorization. No cookie scraping, token import, or private endpoint calls.

## Consequences
Compliance by default; Anthropic available via API key/Bedrock/Vertex.
