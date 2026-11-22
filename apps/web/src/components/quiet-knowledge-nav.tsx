"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";
import { depthCopy } from "@/lib/depth-copy";
import { useLocale } from "./locale-provider";

export const KNOWLEDGE_TABS = [
  ["playbooks", "knowledge.tab.playbooks"], ["documents", "knowledge.tab.documents"],
  ["decisions", "knowledge.tab.decisions"], ["memory", "knowledge.tab.memory"],
  ["artifacts", "knowledge.tab.artifacts"], ["pictures", "knowledge.tab.pictures"],
] as const;
export type KnowledgeTab = (typeof KNOWLEDGE_TABS)[number][0];

/** One collection navigation, shared by Knowledge and its graph destination. */
export function QuietKnowledgeNav({ companyId, active, counts = {} }: { companyId: string; active: KnowledgeTab | "connections"; counts?: Partial<Record<KnowledgeTab, number | null>> }) {
  const locale = useLocale();
  const c = depthCopy(locale);
  return <nav className="q-knowledge-nav" aria-label={t(locale, "knowledge.title")}>
    {KNOWLEDGE_TABS.map(([id, label]) => <Link key={id} href={`/app/c/${companyId}/knowledge?tab=${id}`} scroll={false} aria-current={active === id ? "page" : undefined}>{t(locale, label)}{counts[id] != null && <span className="text-muted"> {counts[id]}</span>}</Link>)}
    <Link href={`/app/c/${companyId}/graph`} aria-current={active === "connections" ? "page" : undefined}>{c.connections}</Link>
  </nav>;
}
