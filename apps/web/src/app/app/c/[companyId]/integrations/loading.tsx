import { workspaceShell } from "@/lib/workspace-theme";
import { QuietToolsLoading } from "@/components/quiet-tools";
export default function Loading() {
  return workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet" ? <QuietToolsLoading /> : null;
}
