/** Server-only rollout choice. No auth, data, or policy behavior changes between shells. */
export function workspaceShell(value: string | undefined): "quiet" | "legacy" {
  return value === "legacy" ? "legacy" : "quiet";
}
