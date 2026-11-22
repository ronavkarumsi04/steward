"use client";

import { createContext, useContext, type ReactNode } from "react";

const QuietSpecialist = createContext(false);

export function QuietSpecialistProvider({ surface, children }: { surface: string; children: ReactNode }) {
  return <QuietSpecialist.Provider value={true}><div className="q-specialist" data-surface={surface}>{children}</div></QuietSpecialist.Provider>;
}

export function useQuietSpecialist() { return useContext(QuietSpecialist); }

/** Keep creation reachable without making a blank form outrank the company's work. */
export function SpecialistDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const quiet = useQuietSpecialist();
  return quiet ? <details className="q-specialist-create"><summary>{label}</summary>{children}</details> : children;
}
