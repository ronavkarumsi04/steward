import type { Metadata } from "next";
import { Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Chat" };

export default function ChatIndex() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty>Pick a conversation or start a new one. Your Chief of Staff plans, delegates to specialist agents and reports back here.</Empty>
    </div>
  );
}
