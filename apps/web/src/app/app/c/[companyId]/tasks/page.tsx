import type { Metadata } from "next";
import { serverApi } from "@/lib/server";
import type { Agent, Goal, Task } from "@/lib/types";
import { TaskBoard } from "@/components/task-board";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ tasks }, { agents }, { goals }] = await Promise.all([
    api.get<{ tasks: Task[] }>(`/companies/${companyId}/tasks?limit=200`),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
    api.get<{ goals: Goal[] }>(`/companies/${companyId}/goals`),
  ]);
  return (
    <div>
      <PageHeader eyebrow="Work" title="Tasks" description="Every task is a unit of work an agent can pick up. Moving a card changes its state; running it starts a durable workflow." />
      <TaskBoard companyId={companyId} tasks={tasks} agents={agents} goals={goals} />
    </div>
  );
}
