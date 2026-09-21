import type { ReactNode } from "react";

export default function OrgLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 md:py-8">{children}</main>;
}
