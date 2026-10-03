import { API_URL, serverFetch } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Unsubscribe landing page and one-click target (RFC 8058).
 *
 * The signed token is verified and applied by the API, which owns the master key — this route never
 * sees or needs it. Both GET (a person clicking the link in an email) and POST (a mail client doing
 * List-Unsubscribe-Post) perform the suppression, because the token itself proves control of the
 * address and the recipient's earlier consent is exactly what is being withdrawn.
 */
type UnsubscribeOutcome =
  | { ok: true; result: { channel: string; address: string } }
  | { ok: false; reason: "unreachable" | "invalid" | "error" };

async function unsubscribe(token: string): Promise<UnsubscribeOutcome> {
  const res = await serverFetch(`${API_URL}/v1/unsubscribe`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: process.env.APP_URL ?? "http://localhost:3000" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { ok: false, reason: "unreachable" as const };
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, reason: body?.error?.code === "invalid_token" ? ("invalid" as const) : ("error" as const) };
  }
  return { ok: true, result: (await res.json()) as { channel: string; address: string } };
}

function page(heading: string, body: string, tone: "ok" | "warn") {
  const accent = tone === "ok" ? "#0a7d29" : "#b4232a";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading} — Steward</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f4ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#182d28;padding:24px">
<main style="max-width:520px;background:#fff;border:1px solid #182d28;border-radius:14px;padding:32px;box-shadow:0 12px 40px #182d2814">
<p style="margin:0 0 12px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#556259">Steward</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:600;border-left:6px solid ${accent};padding-left:12px">${heading}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#35483e">${body}</p>
<p style="margin:0;font-size:13px;line-height:1.55;color:#556259">You can also revoke access to the sender's connected accounts, or ask a human to remove you by replying to any message from them.</p>
</main></body></html>`;
}

function html(body: string, status: number) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function respond(token: string, headOnly: boolean) {
  const outcome = await unsubscribe(token);
  if (outcome.ok) {
    return html(
      page("You have been unsubscribed", `We recorded your request for <strong>${escapeHtml(outcome.result.address)}</strong> and the sender can no longer send you marketing messages to that address. Transactional messages that a service you use must send (such as a receipt you requested) are not affected.`, "ok"),
      200,
    );
  }
  if (headOnly) return new Response(null, { status: 400 });
  const reason = outcome.reason === "invalid" ? "This unsubscribe link is not valid — it may have been truncated by your mail client." : "We could not process that request right now.";
  return html(page("We could not unsubscribe you", `${reason} Reply to the message you received and a human will remove you manually.`, "warn"), 400);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return respond(token, false);
}

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return respond(token, true);
}
