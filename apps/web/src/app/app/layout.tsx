import type { ReactNode } from "react";
import { requireMe } from "@/lib/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireMe("/app");
  return children;
}
