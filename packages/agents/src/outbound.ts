import { unsubscribeUrl } from "@steward/core";

/**
 * Every externally visible message the agents send passes through here, so the promises in the
 * Terms, Acceptable Use Policy and AI terms are enforced by the sender rather than left to the model:
 *
 *  - marketing email carries a working one-click unsubscribe link and the RFC 8058 headers;
 *  - agent-authored messages carry an AI disclosure, which the customer can turn off explicitly;
 *  - SMS gets a short disclosure and STOP/HELP instructions.
 */

export interface EmailComplianceInput {
  appUrl: string;
  masterKey: string;
  organizationId: string;
  companyId: string;
  recipient: string;
  companyName: string;
  /** True when the message is marketing (part of a campaign) and therefore needs an opt-out. */
  marketing: boolean;
  aiDisclosure: boolean;
  text: string;
  html?: string | undefined;
}

export interface EmailComplianceOutput {
  text: string;
  html?: string | undefined;
  headers: Record<string, string>;
  unsubscribeUrl: string | null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function applyEmailCompliance(input: EmailComplianceInput): EmailComplianceOutput {
  const unsubscribe = input.marketing ? unsubscribeUrl(input.appUrl, input.masterKey, { organizationId: input.organizationId, companyId: input.companyId, address: input.recipient, channel: "email" }) : null;
  const disclosure = input.aiDisclosure ? `This email was researched and written by an AI agent acting for ${input.companyName}.` : null;

  const textLines = [input.text.trim()];
  if (disclosure) textLines.push(`— ${disclosure}`);
  if (unsubscribe) textLines.push(`You are receiving this because ${input.companyName} contacted you. Unsubscribe: ${unsubscribe}`);
  const text = textLines.join("\n\n");

  let html = input.html;
  if (html !== undefined || disclosure || unsubscribe) {
    const footerBits: string[] = [];
    if (disclosure) footerBits.push(`<p style="margin:0 0 8px">${escapeHtml(disclosure)}</p>`);
    if (unsubscribe) {
      footerBits.push(
        `<p style="margin:0">You are receiving this because <strong>${escapeHtml(input.companyName)}</strong> contacted you. <a href="${escapeHtml(unsubscribe)}" style="color:#0b5fff">Unsubscribe</a> or reply STOP by email and you will not be contacted again.</p>`,
      );
    }
    const footer = `<hr style="border:none;border-top:1px solid #d9d9e0;margin:24px 0 12px"><div style="font-size:12px;line-height:1.5;color:#6e6e73">${footerBits.join("")}</div>`;
    html = html ? `${html}${footer}` : `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f">${input.text.trim().split("\n").map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join("")}${footer}</div>`;
  }

  const headers: Record<string, string> = {};
  if (unsubscribe) {
    headers["List-Unsubscribe"] = `<${unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { text, html, headers, unsubscribeUrl: unsubscribe };
}

export interface SmsComplianceInput {
  companyName: string;
  aiDisclosure: boolean;
  body: string;
  marketing: boolean;
}

/**
 * Keeps SMS short: carriers and the FCC expect STOP and HELP instructions on recurring marketing
 * messages, and the disclosure must fit inside a single segment where possible.
 */
export function applySmsCompliance(input: SmsComplianceInput): string {
  const lines = [input.body.trim()];
  if (input.aiDisclosure) lines.push(`Sent by an AI assistant for ${input.companyName}.`);
  if (input.marketing) lines.push("Reply STOP to opt out, HELP for help.");
  return lines.join("\n").slice(0, 1600);
}
