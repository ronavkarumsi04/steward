import { serverApi } from "@/lib/server";
import type { Agent, Goal, Task } from "@/lib/types";
import { TaskBoard } from "@/components/task-board";

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
      <h1 className="mb-4 text-xl font-semibold">Tasks</h1>
      <TaskBoard companyId={companyId} tasks={tasks} agents={agents} goals={goals} />
    </div>
  );
}
