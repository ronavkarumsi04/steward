# ADR-0004: Envelope encryption for credentials

Status: Accepted

## Decision
Each secret is encrypted with a per-record AES-256-GCM data key; data keys are wrapped by a master key from `MasterKeyProvider` (env-provided 32-byte key in dev; KMS implementations for production). Ciphertext, wrapped key, nonce, key version stored in the row. API exposes only last4 and fingerprint. Rotation re-wraps data keys without re-encrypting payloads.

## Consequences
Decrypted material lives only in adapter call scope; pino redaction prevents logging.
