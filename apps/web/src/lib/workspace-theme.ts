/** Server-only rollout choice. No auth, data, or policy behavior changes between shells. */
export function workspaceShell(value: string | undefined, deployment?: string): "quiet" | "legacy" {
  if (value === "quiet") return "quiet";
  if (value === "legacy") return "legacy";
  return !value && deployment === "preview" ? "quiet" : "legacy";
}
