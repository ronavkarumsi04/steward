import { randomInt } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { generateToken, hashToken } from "@steward/crypto";
import { auditLog, companionDevices, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";

const PAIRING_TTL_MS = 10 * 60_000;
export const COMPANION_COMMANDS = ["ping", "codex.status", "codex.exec"] as const;
export type CompanionCommand = (typeof COMPANION_COMMANDS)[number];

export type CompanionDeviceRow = typeof companionDevices.$inferSelect;

export interface CompanionDeviceView {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  status: string;
  capabilities: string[];
  pairingExpiresAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  online: boolean;
}

/**
 * Pairing and authentication for Local Companion devices. The control plane stores only hashes of the
 * one-time pairing code and the long-lived device key; the key itself is shown once to the pairing user
 * and then only ever held by the companion process on the user's machine.
 */
export class CompanionService {
  constructor(private readonly db: Db) {}

  private view(r: CompanionDeviceRow, online: boolean): CompanionDeviceView {
    return { id: r.id, organizationId: r.organizationId, userId: r.userId, name: r.name, status: r.status, capabilities: r.capabilities, pairingExpiresAt: r.pairingExpiresAt, lastSeenAt: r.lastSeenAt, createdAt: r.createdAt, online };
  }

  /** Creates a device record in `pairing` state and returns the plaintext one-time code. */
  async beginPairing(scope: TenantScope, name: string) {
    if (!scope.userId) throw new Error("A user is required to pair a companion");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    const [device] = await this.db
      .insert(companionDevices)
      .values({ organizationId: scope.organizationId, userId: scope.userId, name: name.trim() || "Companion", pairingCodeHash: hashToken(code), pairingExpiresAt: expiresAt, status: "pairing" })
      .returning();
    await this.db.insert(auditLog).values({ organizationId: scope.organizationId, actor: scope.actor, action: "companion.pairing_started", target: device!.id, metadata: { name } });
    return { device: this.view(device!, false), code, expiresAt };
  }

  /** Called by the companion with the code the user typed; returns the device key exactly once. */
  async completePairing(code: string, info: { name?: string; capabilities?: string[] }) {
    const [device] = await this.db
      .select()
      .from(companionDevices)
      .where(and(eq(companionDevices.pairingCodeHash, hashToken(code.trim())), eq(companionDevices.status, "pairing"), gt(companionDevices.pairingExpiresAt, new Date()), isNull(companionDevices.deviceKeyHash)))
      .limit(1);
    if (!device) return null;
    const { token, hash } = generateToken("scd");
    const [paired] = await this.db
      .update(companionDevices)
      .set({ deviceKeyHash: hash, pairingCodeHash: null, pairingExpiresAt: null, status: "paired", capabilities: info.capabilities ?? [], name: info.name?.trim() || device.name, lastSeenAt: new Date() })
      .where(eq(companionDevices.id, device.id))
      .returning();
    await this.db.insert(auditLog).values({ organizationId: device.organizationId, actor: { type: "system", component: "companion" }, action: "companion.paired", target: device.id, metadata: { capabilities: info.capabilities ?? [] } });
    return { device: this.view(paired!, true), deviceKey: token };
  }

  /** Resolves a device key presented by a companion. Revoked devices never authenticate. */
  async authenticate(deviceKey: string) {
    const [device] = await this.db.select().from(companionDevices).where(and(eq(companionDevices.deviceKeyHash, hashToken(deviceKey)), eq(companionDevices.status, "paired"))).limit(1);
    return device ?? null;
  }

  async touch(deviceId: string, capabilities?: string[]) {
    await this.db.update(companionDevices).set({ lastSeenAt: new Date(), ...(capabilities ? { capabilities } : {}) }).where(eq(companionDevices.id, deviceId));
  }

  async list(scope: TenantScope, isOnline: (deviceId: string) => boolean) {
    const rows = await this.db.select().from(companionDevices).where(eq(companionDevices.organizationId, scope.organizationId)).orderBy(companionDevices.createdAt);
    return rows.map((r) => this.view(r, r.status === "paired" && isOnline(r.id)));
  }

  async get(scope: TenantScope, id: string) {
    const [r] = await this.db.select().from(companionDevices).where(and(eq(companionDevices.id, id), eq(companionDevices.organizationId, scope.organizationId))).limit(1);
    return r ?? null;
  }

  async revoke(scope: TenantScope, id: string) {
    const [r] = await this.db
      .update(companionDevices)
      .set({ status: "revoked", deviceKeyHash: null, pairingCodeHash: null, pairingExpiresAt: null })
      .where(and(eq(companionDevices.id, id), eq(companionDevices.organizationId, scope.organizationId)))
      .returning();
    if (r) await this.db.insert(auditLog).values({ organizationId: scope.organizationId, actor: scope.actor, action: "companion.revoked", target: id, metadata: {} });
    return r ? this.view(r, false) : null;
  }
}
