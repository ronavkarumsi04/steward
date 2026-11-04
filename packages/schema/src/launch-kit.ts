import { z } from "zod";
import { SITE_ACCENTS, SITE_FONTS, SITE_RADII } from "./site.js";
import type { CompanyProfile } from "./index.js";

/**
 * The first-run "launch kit": the deliverables Steward produces unprompted the moment a company is
 * created, so a founder goes from idea to a positioning, a brand brief, landing-page copy, a recorded
 * target-customer decision and a first week of work orders in one run — with the tool ledger as proof.
 */
export const LAUNCH_KIT_TITLES = {
  positioning: "Positioning",
  brand: "Brand brief",
  landing: "Landing page copy",
} as const;

export const LAUNCH_KIT_MIN_TASKS = 5;

export const LaunchKitDeliverableId = z.enum(["positioning", "brand", "kit", "landing", "decision", "tasks"]);
export type LaunchKitDeliverableId = z.infer<typeof LaunchKitDeliverableId>;

export interface LaunchKitDeliverable {
  id: LaunchKitDeliverableId;
  label: string;
  detail: string;
  status: "pending" | "done";
  /** Document title or decision summary once produced; count for tasks. */
  evidence: string | null;
  documentId: string | null;
}

export const LAUNCH_KIT_DELIVERABLES: ReadonlyArray<{ id: LaunchKitDeliverableId; label: string; detail: string }> = [
  { id: "positioning", label: LAUNCH_KIT_TITLES.positioning, detail: "Who it is for, the problem, the promise, and why now." },
  { id: "brand", label: LAUNCH_KIT_TITLES.brand, detail: "Name check, tagline options, voice, and a starting palette." },
  { id: "kit", label: "Brand kit", detail: "Tagline, tone words and accent saved under Settings → Brand, so the site starter and every post reuse them." },
  { id: "landing", label: LAUNCH_KIT_TITLES.landing, detail: "Hero, three benefits, proof, and a call to action, ready to paste into Site Studio." },
  { id: "decision", label: "Target customer decided", detail: "One recorded decision you can overturn later." },
  { id: "tasks", label: `First ${LAUNCH_KIT_MIN_TASKS} work orders`, detail: "The week-one tasks, each with an owner agent and a clear done state." },
];

type ProfileInput = Partial<z.infer<typeof CompanyProfile>> & { name: string };

function list(items: readonly string[] | undefined, fallback: string) {
  const clean = (items ?? []).map((s) => s.trim()).filter(Boolean);
  return clean.length ? clean.join("; ") : fallback;
}

/** The instruction handed to the Chief of Staff. Deterministic so the verifier and UI can rely on the titles. */
export function launchKitBrief(profile: ProfileInput): string {
  const name = profile.name.trim() || "the company";
  return [
    `Launch kit for ${name}. Produce every deliverable below in this order, using exactly the tools and titles given. Do not ask questions; where the brief is silent, decide and record the assumption inside the document.`,
    "",
    "Company brief:",
    `- Idea: ${profile.description?.trim() || "(not provided — infer from the name and say so)"}`,
    `- Stage: ${profile.stage ?? "idea"}`,
    `- Business model: ${profile.businessModel?.trim() || "undecided — propose one"}`,
    `- Target customers (founder's words): ${list(profile.targetCustomers, "undecided — propose one primary segment")}`,
    `- Constraints: ${list(profile.constraints, "none given")}`,
    profile.tagline?.trim() ? `- Working tagline: ${profile.tagline.trim()}` : null,
    profile.brandVoice?.trim() ? `- Brand voice notes: ${profile.brandVoice.trim()}` : null,
    "",
    "Deliverables:",
    `1. document.write — title "${LAUNCH_KIT_TITLES.positioning}". Sections: Customer, Problem, Promise, Why now, Alternatives, One-line positioning statement. Under 350 words.`,
    `2. decision.record — the primary target customer segment (one segment, one sentence of rationale, and what would make you change it).`,
    `3. document.write — title "${LAUNCH_KIT_TITLES.brand}". Sections: Name check (does "${name}" work; two alternatives), 3 tagline options, Voice (3 adjectives with a do/don't each), Starting palette (3 hex colours with roles), Type direction.`,
    `4. company.brand_update — commit the brief to the brand kit: tagline (your best option, under 160 characters), voice.tone (the 3 adjectives), voice.do and voice.dont (2–4 short phrases each), accent (one of ${SITE_ACCENTS.join(", ")}; the closest to your palette), font (one of ${SITE_FONTS.join(", ")}), radius (one of ${SITE_RADII.join(", ")}), dark (true only if the palette is dark-first), mark ("wordmark" or "monogram"). Decide every field; the site starter and every post reuse them.`,
    `5. document.write — title "${LAUNCH_KIT_TITLES.landing}". Sections: Hero headline + subhead, 3 benefits (title + one line), Proof placeholder, Primary call to action, FAQ (3). Written to be pasted into a landing page as-is.`,
    `6. task.create — ${LAUNCH_KIT_MIN_TASKS} week-one tasks. Each: an imperative title, a one-line done state, a priority, and the agent that should own it (engineering, marketing, sales, research or finance). Include at least one customer conversation and one measurable launch step.`,
    "",
    "Finish with a short report listing what was produced and the two biggest open questions for the founder.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export interface LaunchKitToolCall {
  toolName: string;
  input: unknown;
  output: unknown;
  status: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function documentIdFrom(output: unknown): string | null {
  const direct = str(field(field(output, "data"), "id")) ?? str(field(output, "documentId")) ?? str(field(output, "id"));
  if (direct) return direct;
  const text = str(field(output, "content")) ?? (typeof output === "string" ? output : null);
  const m = text?.match(/\b(doc_[A-Za-z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/);
  return m?.[1] ?? null;
}

/**
 * Whether a launch run was briefed to save the brand kit. Runs started before the brief had that step
 * finished honestly without one, so their checklist must not hold a line they were never asked for.
 * An unknown instruction (not a string) is treated as the current brief.
 */
export function launchKitAsksForKit(instruction: unknown): boolean {
  return typeof instruction === "string" ? instruction.includes("company.brand_update") : true;
}

/** Derive the checklist from the run's tool ledger: a deliverable counts only when the tool call succeeded. */
export function launchKitProgress(calls: readonly LaunchKitToolCall[], options: { kit?: boolean } = {}): LaunchKitDeliverable[] {
  const ok = calls.filter((c) => c.status === "succeeded");
  const docs = ok.filter((c) => c.toolName === "document.write");
  const findDoc = (title: string) => {
    const want = title.toLowerCase();
    return docs.find((c) => str(field(c.input, "title"))?.toLowerCase() === want) ?? docs.find((c) => str(field(c.input, "title"))?.toLowerCase().includes(want.split(" ")[0]!));
  };
  const decision = ok.find((c) => c.toolName === "decision.record");
  const kit = ok.filter((c) => c.toolName === "company.brand_update").at(-1);
  const tasks = ok.filter((c) => c.toolName === "task.create");

  const deliverables = options.kit === false ? LAUNCH_KIT_DELIVERABLES.filter((d) => d.id !== "kit") : LAUNCH_KIT_DELIVERABLES;
  return deliverables.map((d) => {
    let evidence: string | null = null;
    let documentId: string | null = null;
    if (d.id === "positioning" || d.id === "brand" || d.id === "landing") {
      const call = findDoc(LAUNCH_KIT_TITLES[d.id]);
      if (call) {
        evidence = str(field(call.input, "title"));
        documentId = documentIdFrom(call.output);
      }
    } else if (d.id === "kit") {
      if (kit) {
        const tone = field(field(kit.input, "voice"), "tone");
        const tones = Array.isArray(tone) ? tone.map(str).filter((t): t is string => t !== null) : [];
        evidence = str(field(kit.input, "tagline")) ?? (tones.length ? tones.join(", ") : null) ?? "Saved";
      }
    } else if (d.id === "decision") {
      evidence = decision ? (str(field(decision.input, "title")) ?? str(field(decision.input, "decision")) ?? str(field(decision.input, "summary")) ?? "Recorded") : null;
    } else if (d.id === "tasks") {
      evidence = tasks.length ? `${tasks.length} created` : null;
      if (tasks.length < LAUNCH_KIT_MIN_TASKS && tasks.length > 0) evidence = `${tasks.length} of ${LAUNCH_KIT_MIN_TASKS} created`;
    }
    const done = d.id === "tasks" ? tasks.length >= LAUNCH_KIT_MIN_TASKS : evidence !== null;
    return { ...d, status: done ? "done" : "pending", evidence, documentId };
  });
}
