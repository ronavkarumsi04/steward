import type { ReactNode } from "react";
import { serverApi } from "@/lib/server";
import type { Conversation } from "@/lib/types";
import { ConversationList } from "@/components/chat";

export default async function ChatLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const { conversations } = await api.get<{ conversations: Conversation[] }>(`/companies/${companyId}/conversations`);
  return (
    <div className="chat-spread">
      <aside className="min-h-0 min-w-0"><ConversationList companyId={companyId} conversations={conversations} /></aside>
      <section className="min-h-0 min-w-0">{children}</section>
    </div>
  );
}
