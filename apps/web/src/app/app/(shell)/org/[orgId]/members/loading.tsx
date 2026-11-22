import { getLocale } from "@/lib/server";
import { workspaceShell } from "@/lib/workspace-theme";
import { DepthLoading } from "@/components/quiet-depth";
import { PageSkeleton } from "@/components/feedback";

export default async function Loading() {
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) !== "quiet") return <PageSkeleton />;
  return <DepthLoading locale={await getLocale()} />;
}
