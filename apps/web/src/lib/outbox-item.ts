import type { Approval } from "@/lib/types";

/** The three actions whose approvals are the founder's Outbox: nothing leaves until one is approved. */
export const OUTBOX_ACTIONS = ["email.send", "social.publish", "sms.send"] as const;
export const isOutboxAction = (action: string) => (OUTBOX_ACTIONS as readonly string[]).includes(action);
export const OUTBOX_LIMITS: Record<string, number> = { x: 280, linkedin: 3000 };

export type OutboxKind = "email" | "social" | "sms";

export function outboxItem(a: Approval): { kind: OutboxKind; to: string; subject: string; text: string; field: "text" | "body" | "message"; network?: string } {
  const p = a.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  if (a.action === "social.publish") return { kind: "social", to: "public", subject: "", text: str("text"), field: "text", network: str("network") || a.affectedSystem };
  if (a.action === "sms.send") return { kind: "sms", to: str("to"), subject: "", text: str("body") || str("text") || str("message"), field: p.body !== undefined ? "body" : p.message !== undefined ? "message" : "text" };
  return { kind: "email", to: str("to"), subject: str("subject"), text: str("text"), field: "text" };
}

/** One line a founder can decide from: the subject or first line of the message, and where it would go. */
export function outboxHeadline(a: Approval): { title: string; detail: string } | null {
  if (!isOutboxAction(a.action)) return null;
  const m = outboxItem(a);
  const first = m.subject || m.text.split("\n").find((l) => l.trim()) || "(empty message)";
  const title = first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first;
  const where = m.kind === "social" ? `${(m.network || "social").toUpperCase()} post` : m.kind === "sms" ? `Text to ${m.to || "—"}` : `Email to ${m.to || "—"}`;
  return { title, detail: `${where} waiting for your go-ahead` };
}
