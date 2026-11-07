import type { Metadata } from "next";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Agent, Goal, Task } from "@/lib/types";
import { TaskBoard } from "@/components/task-board";
import { PageHeader } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "tasks.title") };
}

export default async function TasksPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const locale = await getLocale();
  const [{ tasks }, { agents }, { goals }] = await Promise.all([
    api.get<{ tasks: Task[] }>(`/companies/${companyId}/tasks?limit=200`),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
    api.get<{ goals: Goal[] }>(`/companies/${companyId}/goals`),
  ]);
  return (
    <div>
      <PageHeader eyebrow={t(locale, "tasks.eyebrow")} title={t(locale, "tasks.title")} description={t(locale, "tasks.description")} />
      <TaskBoard companyId={companyId} tasks={tasks} agents={agents} goals={goals} />
    </div>
  );
}
