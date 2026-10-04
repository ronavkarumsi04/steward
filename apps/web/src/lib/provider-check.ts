export type ProviderCheckResult =
  | { ok: true; models: number; verification?: "catalog_only" | "connection" }
  | { ok: false; error: { code: string; message: string } };

export function providerCheckMessage(result: ProviderCheckResult): string {
  if (!result.ok) return `${result.error.code}: ${result.error.message}`;
  if (result.verification === "catalog_only") {
    return `Catalog available · ${result.models} models. API key and generation remain unverified; qualify them with a budgeted agent run.`;
  }
  return `OK · ${result.models} models discovered`;
}
