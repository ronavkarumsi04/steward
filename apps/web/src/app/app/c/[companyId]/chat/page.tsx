import type { Metadata } from "next";
import { ChatStarters } from "@/components/chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatIndex({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <ChatStarters companyId={companyId} />;
}
