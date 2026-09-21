import type { ReactNode } from "react";
import { serverApi } from "@/lib/server";
import type { Conversation } from "@/lib/types";
import { ConversationList } from "@/components/chat";

export default async function ChatLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const { conversations } = await api.get<{ conversations: Conversation[] }>(`/companies/${companyId}/conversations`);
  return (
    <div className="grid min-h-[60vh] gap-4 lg:h-[calc(100vh-7.5rem)] lg:grid-cols-[16rem_1fr]">
      <aside className="card overflow-hidden p-2"><ConversationList companyId={companyId} conversations={conversations} /></aside>
      <section className="card overflow-hidden">{children}</section>
    </div>
  );
}
