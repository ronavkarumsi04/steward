# @steward/companion

The Steward **Local Companion** lets agents use your ChatGPT/Codex subscription without your login ever leaving your machine.
It is a small daemon that pairs with a Steward server and runs the **official Codex CLI** (`codex exec`) locally on request.

## How it works

```
Steward API ──(HTTPS long-poll)──▶ steward-companion run ──▶ codex exec --json … ──▶ your ChatGPT login (~/.codex, managed by Codex)
```

- **Pairing**: an org admin clicks *Pair a new companion* in Organization → AI providers and gets a one-time 6-digit code (valid 10 min).
  `steward-companion pair` exchanges it for a device key (`scd_…`) that is shown once and stored **hashed** on the server.
  The plaintext key lives only in `~/.steward/companion.json` (mode `0600`).
- **Commands** are limited to `ping`, `codex.status` and `codex.exec`. Anything else is refused by both the server and the daemon.
- **Credentials**: the companion never reads Codex's auth files. It only shells out to `codex login status` and `codex exec`.
- **Sandbox**: `codex exec` runs with `--sandbox read-only --ephemeral` in an empty temp directory by default.
- **Revocation**: revoking the device in Steward invalidates the key immediately; the daemon deletes its local copy and exits.

## Install

```sh
npm i -g @openai/codex @steward/companion
codex login                                   # opens the ChatGPT login in your browser
steward-companion pair --server https://steward.example.com/api --code 123456
steward-companion run
```

`--server` is the URL the web UI prints in the pairing dialog (the web app's `/api` proxy, or `PUBLIC_API_URL`).
Then add a provider of type **OpenAI Codex (ChatGPT subscription via Local Companion)** bound to the paired device.

## Commands

| Command | Purpose |
| --- | --- |
| `pair --server URL --code NNNNNN [--name label] [--codex path] [--sandbox read-only\|workspace-write]` | Exchange a pairing code for a device key |
| `run [--concurrency N]` | Long-poll for work and execute it (run under a supervisor / launchd / systemd) |
| `status` | Print pairing, reachability and Codex login state as JSON |
| `unpair` | Delete the local device key |

Environment: `STEWARD_COMPANION_CONFIG` (config file path), `STEWARD_HOME` (defaults to `~/.steward`).
