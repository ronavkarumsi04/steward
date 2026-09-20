import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface MasterKeyProvider {
  /** Returns the current master key and its version id. */
  current(): Promise<{ version: string; key: Buffer }>;
  /** Returns the key for a given version (for decrypting older records). */
  byVersion(version: string): Promise<Buffer>;
}

/** Master key supplied via environment (base64 or hex, 32 bytes). Suitable for dev/single-node. */
export class EnvMasterKeyProvider implements MasterKeyProvider {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentVersion: string;
  constructor(raw: string | undefined, previous: Record<string, string> = {}) {
    if (!raw) throw new Error("STEWARD_MASTER_KEY is not set");
    const key = decodeKey(raw);
    this.currentVersion = fingerprint(key).slice(0, 8);
    this.keys.set(this.currentVersion, key);
    for (const [v, k] of Object.entries(previous)) this.keys.set(v, decodeKey(k));
  }
  async current() {
    return { version: this.currentVersion, key: this.keys.get(this.currentVersion)! };
  }
  async byVersion(version: string) {
    const k = this.keys.get(version);
    if (!k) throw new Error(`Unknown master key version ${version}`);
    return k;
  }
}

function decodeKey(raw: string): Buffer {
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("Master key must be 32 bytes (hex or base64)");
  return buf;
}

export interface Envelope {
  v: 1;
  keyVersion: string;
  wrappedKey: string; // base64 iv|tag|ciphertext of data key
  iv: string;
  tag: string;
  ciphertext: string;
}

function aesEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function aesDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad?: Buffer) {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export class EnvelopeCrypto {
  constructor(private readonly master: MasterKeyProvider) {}

  async encrypt(plaintext: string, aad?: string): Promise<Envelope> {
    const { version, key } = await this.master.current();
    const dataKey = randomBytes(32);
    const wrapped = aesEncrypt(key, dataKey);
    const body = aesEncrypt(dataKey, Buffer.from(plaintext, "utf8"), aad ? Buffer.from(aad) : undefined);
    return {
      v: 1,
      keyVersion: version,
      wrappedKey: Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ct]).toString("base64"),
      iv: body.iv.toString("base64"),
      tag: body.tag.toString("base64"),
      ciphertext: body.ct.toString("base64"),
    };
  }

  async decrypt(env: Envelope, aad?: string): Promise<string> {
    const master = await this.master.byVersion(env.keyVersion);
    const w = Buffer.from(env.wrappedKey, "base64");
    const dataKey = aesDecrypt(master, w.subarray(0, 12), w.subarray(12, 28), w.subarray(28));
    const pt = aesDecrypt(
      dataKey,
      Buffer.from(env.iv, "base64"),
      Buffer.from(env.tag, "base64"),
      Buffer.from(env.ciphertext, "base64"),
      aad ? Buffer.from(aad) : undefined,
    );
    return pt.toString("utf8");
  }

  /** Re-wrap the data key under the current master key without touching the payload. */
  async rewrap(env: Envelope): Promise<Envelope> {
    const old = await this.master.byVersion(env.keyVersion);
    const w = Buffer.from(env.wrappedKey, "base64");
    const dataKey = aesDecrypt(old, w.subarray(0, 12), w.subarray(12, 28), w.subarray(28));
    const { version, key } = await this.master.current();
    const wrapped = aesEncrypt(key, dataKey);
    return { ...env, keyVersion: version, wrappedKey: Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ct]).toString("base64") };
  }
}

export function fingerprint(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function last4(secret: string): string {
  return secret.length <= 4 ? "****" : secret.slice(-4);
}

/** Generates an opaque token and its storage hash. Tokens are prefixed for identification. */
export function generateToken(prefix: string, bytes = 32): { token: string; hash: string } {
  const token = `${prefix}_${randomBytes(bytes).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hmacSign(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function hmacVerify(secret: string, payload: string | Buffer, signatureHex: string): boolean {
  const expected = Buffer.from(hmacSign(secret, payload), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(signatureHex.replace(/^sha256=/, ""), "hex");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function randomCode(length = 8, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /ghp_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?:re|pm|SG)_[A-Za-z0-9_.-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
];

/** Redacts likely secrets from free text (tool output, logs, model I/O). */
export function redactSecrets(text: string, extra: string[] = []): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  for (const s of extra) if (s && s.length >= 6) out = out.split(s).join("[REDACTED]");
  return out;
}
