import type { ReactNode } from "react";

/** Add a persistent field name in Quiet without changing legacy markup or form data. */
export function SettingsField({ quiet, label, children }: { quiet: boolean; label: string; children: ReactNode }) {
  return quiet ? <label className="q-settings-field"><span className="label">{label}</span>{children}</label> : <>{children}</>;
}
