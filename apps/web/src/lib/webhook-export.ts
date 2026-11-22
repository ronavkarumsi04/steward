/** Never render a credential-bearing webhook URL, even when clipboard access is blocked. */
export async function copyWebhookUrl(url: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function downloadWebhookUrl(url: string) {
  const objectUrl = URL.createObjectURL(new Blob([url], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "steward-webhook.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
