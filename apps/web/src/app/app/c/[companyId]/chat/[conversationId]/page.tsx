import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { Agent, Conversation, Message } from "@/lib/types";
import { ChatView } from "@/components/chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ConversationPage({ params }: { params: Promise<{ companyId: string; conversationId: string }> }) {
  const { companyId, conversationId } = await params;
  const api = await serverApi();
  const [data, { agents }] = await Promise.all([
    tryApi(() => api.get<{ conversation: Conversation; messages: Message[] }>(`/companies/${companyId}/conversations/${conversationId}`)),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
  ]);
  if (!data) notFound();
  return <ChatView companyId={companyId} conversation={data.conversation} initialMessages={data.messages} agents={agents} />;
}
