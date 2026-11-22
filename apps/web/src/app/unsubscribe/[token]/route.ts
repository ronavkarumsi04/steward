import { API_URL, serverFetch } from "@/lib/server";
import { quietPublicEnabled } from "@/lib/public-design";

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
  if (quietPublicEnabled(process.env)) return quietPage(heading, body);
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

/** Critical utility result: local HTML/CSS only, with no script or font request. */
function quietPage(heading: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${heading} — Steward</title><style>
:root{color-scheme:light;--canvas:#ffffff;--ink:#19271f;--muted:#5e6b63;--border:#e1e7e3;--action:#245c41}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--canvas:#141b17;--ink:#edf4ef;--muted:#a7b7ac;--border:#334439;--action:#a2d1af}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--ink);font:400 16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}main{width:100%;max-width:560px;padding:32px;border:1px solid var(--border);border-radius:10px;overflow-wrap:anywhere}.brand{display:flex;align-items:center;gap:10px;margin:0 0 32px;color:var(--action);font-size:18px;font-weight:650}h1{margin:0 0 16px;font-size:30px;line-height:1.2;letter-spacing:-.035em;font-weight:650}p{margin:0 0 20px;color:var(--muted);font-size:16px}strong{color:var(--ink)}.fallback{padding-top:20px;border-top:1px solid var(--border);font-size:14px}a{color:var(--action);display:inline-flex;align-items:center;min-height:44px;text-underline-offset:5px}a:focus-visible{outline:2px solid var(--action);outline-offset:4px}@media(max-width:400px){main{padding:24px}h1{font-size:26px}}
</style></head><body><main aria-labelledby="unsubscribe-title"><div class="brand"><svg width="26" height="26" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M18 4H58V50H53V8H18Z M11 10H51V56H46V14H11Z M4 16H44V62H4Z M10 25V29H32V25Z M10 33V37H38V33Z M10 41V45H26V41Z" fill-rule="evenodd"/></svg>Steward</div><h1 id="unsubscribe-title">${heading}</h1><p>${body}</p><p class="fallback">You can also revoke access to the sender's connected accounts, or ask a human to remove you by replying to any message from them.</p><a href="/">Back to Steward</a></main></body></html>`;
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
