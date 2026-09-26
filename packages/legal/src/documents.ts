import { legalConfigFromEnv, legalContact, type LegalConfig } from "./config.js";
import { CORE_DOCUMENTS } from "./documents-core.js";
import { DATA_DOCUMENTS } from "./documents-data.js";
import type { Block, LegalDocSlug, LegalDocument, Section } from "./types.js";

export const LEGAL_DOCUMENTS: LegalDocument[] = [...CORE_DOCUMENTS, ...DATA_DOCUMENTS];

const BY_SLUG = new Map<string, LegalDocument>(LEGAL_DOCUMENTS.map((d) => [d.slug, d]));

export function getDocument(slug: string): LegalDocument | undefined {
  return BY_SLUG.get(slug);
}

export function isLegalSlug(slug: string): slug is LegalDocSlug {
  return BY_SLUG.has(slug);
}

/** Documents a user must accept, in the order they are presented at registration. */
export function acceptanceDocuments(): LegalDocument[] {
  return LEGAL_DOCUMENTS.filter((d) => d.requiresAcceptance);
}

export interface DocumentVersion {
  version: string;
  effectiveDate: string;
}

/** Version registry: the API compares stored acceptances against these values. */
export const LEGAL_VERSIONS: Record<string, DocumentVersion> = Object.fromEntries(
  LEGAL_DOCUMENTS.map((d) => [d.slug, { version: d.version, effectiveDate: d.effectiveDate }]),
);

const TOKENS: Array<[string, (cfg: LegalConfig) => string]> = [
  ["operator", (c) => c.operator],
  ["operatorName", (c) => c.operatorName],
  ["serviceName", (c) => c.serviceName],
  ["minimumAge", (c) => String(c.minimumAge)],
  ["governingLaw", (c) => c.governingLaw],
  ["venue", (c) => c.venue],
  ["contact", (c) => legalContact(c)],
  ["repositoryUrl", (c) => c.repositoryUrl],
  ["hostingRegion", (c) => c.hostingRegion],
  ["effectiveDate", (c) => c.effectiveDate],
  ["legalEntityName", (c) => c.legalEntityName ?? "the Steward open-source project"],
  ["legalEntityAddress", (c) => c.legalEntityAddress ?? "the address published in the repository profile"],
];

/** Replaces `{{token}}` with operator facts. Unknown tokens are left intact so a test can catch them. */
export function interpolate(text: string, cfg: LegalConfig): string {
  let out = text;
  for (const [token, value] of TOKENS) out = out.split(`{{${token}}}`).join(value(cfg));
  return out;
}

function mapBlock(block: Block, cfg: LegalConfig): Block {
  switch (block.kind) {
    case "p":
      return { kind: "p", text: interpolate(block.text, cfg) };
    case "list":
      return { ...block, items: block.items.map((i) => interpolate(i, cfg)) };
    case "table":
      return { kind: "table", head: block.head.map((h) => interpolate(h, cfg)), rows: block.rows.map((r) => r.map((cell) => interpolate(cell, cfg))) };
    case "callout":
      return { ...block, title: interpolate(block.title, cfg), text: interpolate(block.text, cfg) };
    case "defs":
      return { kind: "defs", items: block.items.map((i) => ({ term: interpolate(i.term, cfg), text: interpolate(i.text, cfg) })) };
  }
}

function mapSection(section: Section, cfg: LegalConfig): Section {
  return { id: section.id, heading: interpolate(section.heading, cfg), blocks: section.blocks.map((b) => mapBlock(b, cfg)) };
}

/** Resolves a document's operator-specific text for rendering. */
export function resolveDocument(doc: LegalDocument, cfg: LegalConfig = legalConfigFromEnv()): LegalDocument {
  return { ...doc, title: interpolate(doc.title, cfg), summary: interpolate(doc.summary, cfg), sections: doc.sections.map((s) => mapSection(s, cfg)) };
}

export function resolvedDocuments(cfg: LegalConfig = legalConfigFromEnv()): LegalDocument[] {
  return LEGAL_DOCUMENTS.map((d) => resolveDocument(d, cfg));
}

/** Plain-text rendering, used for diffs, the API, and tests. */
export function documentToText(doc: LegalDocument, cfg: LegalConfig = legalConfigFromEnv()): string {
  const d = resolveDocument(doc, cfg);
  const lines: string[] = [`# ${d.title}`, `Version ${d.version} — effective ${d.effectiveDate}`, "", d.summary, ""];
  for (const section of d.sections) {
    lines.push(`## ${section.heading}`, "");
    for (const block of section.blocks) {
      if (block.kind === "p") lines.push(block.text, "");
      if (block.kind === "list") {
        block.items.forEach((item, i) => lines.push(`${block.ordered ? `${i + 1}.` : "-"} ${item}`));
        lines.push("");
      }
      if (block.kind === "table") {
        lines.push(`| ${block.head.join(" | ")} |`, `| ${block.head.map(() => "---").join(" | ")} |`);
        for (const row of block.rows) lines.push(`| ${row.join(" | ")} |`);
        lines.push("");
      }
      if (block.kind === "callout") lines.push(`> ${block.title}: ${block.text}`, "");
      if (block.kind === "defs") {
        for (const item of block.items) lines.push(`- ${item.term}: ${item.text}`);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export type { LegalConfig };
