import { LEGAL_DOCUMENTS, LEGAL_VERSIONS, getDocument } from "./documents.js";

/**
 * The documents a person must affirmatively accept to hold an account, and the versions they must
 * have accepted. Everything else on the legal hub is disclosure rather than contract.
 */
export const REQUIRED_AGREEMENTS = ["terms", "privacy", "acceptable-use"] as const;
export type RequiredAgreement = (typeof REQUIRED_AGREEMENTS)[number];

export const REQUIRED_AGREEMENT_TITLES: Record<RequiredAgreement, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  "acceptable-use": "Acceptable Use Policy",
};

/** Current required version per document, derived from the documents themselves so they cannot drift. */
export const REQUIRED_VERSIONS: Record<RequiredAgreement, string> = Object.fromEntries(
  REQUIRED_AGREEMENTS.map((slug) => {
    const doc = getDocument(slug);
    if (!doc) throw new Error(`Required agreement "${slug}" is missing from the legal registry`);
    if (!doc.requiresAcceptance) throw new Error(`Required agreement "${slug}" must set requiresAcceptance: true`);
    return [slug, doc.version];
  }),
) as Record<RequiredAgreement, string>;

export interface AcceptedAgreement {
  document: string;
  version: string;
  acceptedAt: Date | string;
}

export interface PendingAgreement {
  document: RequiredAgreement;
  title: string;
  acceptedVersion: string | null;
  requiredVersion: string;
}

/**
 * Which required documents the user still needs to accept, either because they never accepted it or
 * because its version changed since they did. An empty result means the account is up to date.
 */
export function pendingAgreements(accepted: ReadonlyArray<AcceptedAgreement>): PendingAgreement[] {
  const latest = new Map<string, { version: string; at: number }>();
  for (const record of accepted) {
    const at = new Date(record.acceptedAt).getTime();
    const prior = latest.get(record.document);
    // Keep the most recent acceptance: a user who accepted an older version and later accepted the
    // current one is up to date, regardless of the order the rows come back in.
    if (!prior || at >= prior.at) latest.set(record.document, { version: record.version, at });
  }
  const pending: PendingAgreement[] = [];
  for (const slug of REQUIRED_AGREEMENTS) {
    const required = REQUIRED_VERSIONS[slug];
    const seen = latest.get(slug)?.version ?? null;
    if (seen !== required) pending.push({ document: slug, title: REQUIRED_AGREEMENT_TITLES[slug], acceptedVersion: seen, requiredVersion: required });
  }
  return pending;
}

export function hasAcceptedEverything(accepted: ReadonlyArray<AcceptedAgreement>): boolean {
  return pendingAgreements(accepted).length === 0;
}

/** Payload the UI renders for the clickwrap control. */
export function clickwrapCopy(): Array<{ document: RequiredAgreement; title: string; version: string; href: string }> {
  return REQUIRED_AGREEMENTS.map((slug) => ({ document: slug, title: REQUIRED_AGREEMENT_TITLES[slug], version: REQUIRED_VERSIONS[slug], href: `/legal/${slug}` }));
}

/** A stable, human-readable statement of what was agreed to, stored with each acceptance. */
export function acceptanceStatement(slug: RequiredAgreement, version: string): string {
  return `I accept the ${REQUIRED_AGREEMENT_TITLES[slug]} (version ${version})`;
}

/** The full acceptance surface, for /legal hub listings. */
export function legalHubSections() {
  const everyone = LEGAL_DOCUMENTS.filter((d) => d.audience === "everyone");
  const business = LEGAL_DOCUMENTS.filter((d) => d.audience === "business-customers");
  return { everyone, business };
}

export { LEGAL_DOCUMENTS, LEGAL_VERSIONS };
