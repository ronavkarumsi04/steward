import { PageSkeleton } from "@/components/feedback";
import { QuietDepthLoading } from "@/components/quiet-depth";
import { getLocale } from "@/lib/server";
import { t } from "@/lib/i18n";
import { workspaceShell } from "@/lib/workspace-theme";

export default async function Loading() {
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) !== "quiet") return <PageSkeleton />;
  return <QuietDepthLoading label={t(await getLocale(), "activity.loading")} />;
}
