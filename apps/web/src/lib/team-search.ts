import type { Agent } from "./types";
import { t, type Locale, type MessageKey } from "./i18n";

export function agentMatches(agent: Agent, query: string, locale: Locale) {
  const role = t(locale, `role.${agent.kind}` as MessageKey);
  const text = [agent.name, agent.kind, role, agent.description, ...agent.toolAllowlist].join(" ");
  return text.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale));
}
