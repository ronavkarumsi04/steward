/** Renderable building blocks. Kept as data so one renderer serves every document and the API can
 * read versions without pulling in any presentation code. */

export type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "callout"; tone: "info" | "warn"; title: string; text: string }
  | { kind: "defs"; items: Array<{ term: string; text: string }> };

export interface Section {
  /** Stable anchor id; also used for deep links from the app. */
  id: string;
  heading: string;
  blocks: Block[];
}

export type LegalDocSlug =
  | "terms"
  | "privacy"
  | "acceptable-use"
  | "ai-terms"
  | "integrations"
  | "subprocessors"
  | "dpa"
  | "retention"
  | "cookies"
  | "security"
  | "accessibility"
  | "api-terms"
  | "copyright"
  | "third-party-notices"
  | "support";

export interface LegalDocument {
  slug: LegalDocSlug;
  title: string;
  /** One-line description used on the legal hub and in metadata. */
  summary: string;
  /** Dotted version, bumped whenever material text changes. Persisted with acceptances. */
  version: string;
  /** ISO date the current version took effect. */
  effectiveDate: string;
  /** Part of the registration clickwrap. */
  requiresAcceptance: boolean;
  /** Who the document is aimed at, so the hub can group them. */
  audience: "everyone" | "business-customers";
  sections: Section[];
}

/** A document plus the operator-specific facts resolved for rendering. */
export interface RenderedDocument extends LegalDocument {
  /** Facts the text interpolates, so a reader can see exactly which operator is making the promise. */
  config: import("./config.js").LegalConfig;
}
