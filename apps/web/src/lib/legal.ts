import "server-only";
import {
  CUSTOMER_CONNECTED_SERVICES,
  LEGAL_DOCUMENTS,
  RETENTION_POLICY,
  getDocument,
  legalConfigFromEnv,
  legalContact,
  resolveDocument,
  subprocessorsFromEnv,
  type LegalDocument,
} from "@steward/legal";

/** Operator-specific facts, resolved once per request from the deployment's environment. */
export function legalConfig() {
  return legalConfigFromEnv();
}

export function legalContactChannel(): string {
  return legalContact(legalConfig());
}

export function documentsForHub(): LegalDocument[] {
  const cfg = legalConfig();
  return LEGAL_DOCUMENTS.map((d) => resolveDocument(d, cfg));
}

export function documentBySlug(slug: string): LegalDocument | null {
  const doc = getDocument(slug);
  return doc ? resolveDocument(doc, legalConfig()) : null;
}

export function legalSlugs(): string[] {
  return LEGAL_DOCUMENTS.map((d) => d.slug);
}

/** Only the subprocessors actually in use, so the page never claims a vendor we do not use. */
export function activeSubprocessors() {
  return subprocessorsFromEnv().filter((s) => s.status === "in use");
}

export function retentionRules() {
  return RETENTION_POLICY;
}

export function connectedServices() {
  return CUSTOMER_CONNECTED_SERVICES;
}
