/**
 * Interface languages. One flat catalog per locale, keyed by the English string's role, not its text, so a
 * key survives copy edits. Coverage is honest: only the keys listed here are translated; everything else
 * stays English until it is added, and /compare says "Partly" until the catalog covers the workspace.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

export function resolveLocale(tag: string | null | undefined): Locale {
  const base = (tag ?? "en").toLowerCase().split("-")[0] ?? "en";
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : "en";
}

const en = {
  "nav.today": "TODAY",
  "nav.work": "WORK",
  "nav.business": "BUSINESS",
  "nav.setup": "MEMORY & SETUP",
  "nav.studio": "Studio",
  "nav.approvals": "Approvals",
  "nav.runs": "Runs",
  "nav.tasks": "Tasks",
  "nav.chat": "Chat",
  "nav.activity": "Activity",
  "nav.projects": "Projects",
  "nav.code": "Code",
  "nav.browser": "Browser",
  "nav.workflows": "Workflows",
  "nav.signals": "Signals",
  "nav.growth": "Growth",
  "nav.finance": "Finance",
  "nav.website": "Website",
  "nav.knowledge": "Knowledge",
  "nav.graph": "Graph",
  "nav.agents": "Agents",
  "nav.marketplace": "Marketplace",
  "nav.integrations": "Integrations",
  "nav.settings": "Settings",
  "nav.pending": "pending",
  "nav.running": "running",
  "top.providers": "Providers",
  "top.integrations": "Integrations",
  "top.members": "Members",
  "top.privacy": "Data & privacy",
  "top.inbox": "Inbox",
  "top.inboxLong": "Inbox: everything waiting on you",
  "top.account": "Account",
  "top.accountLong": "Account and privacy",
  "top.system": "System",
  "top.signOut": "Sign out",
  "account.language": "Language",
  "account.languageHelp": "The workspace navigation reads in this language; the rest follows as the catalog grows.",
  "account.languageSaved": "Saved. Reloading in your language.",
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "nav.today": "HOY",
  "nav.work": "TRABAJO",
  "nav.business": "NEGOCIO",
  "nav.setup": "MEMORIA Y AJUSTES",
  "nav.studio": "Estudio",
  "nav.approvals": "Aprobaciones",
  "nav.runs": "Ejecuciones",
  "nav.tasks": "Tareas",
  "nav.chat": "Chat",
  "nav.activity": "Actividad",
  "nav.projects": "Proyectos",
  "nav.code": "Código",
  "nav.browser": "Navegador",
  "nav.workflows": "Flujos",
  "nav.signals": "Señales",
  "nav.growth": "Crecimiento",
  "nav.finance": "Finanzas",
  "nav.website": "Sitio web",
  "nav.knowledge": "Conocimiento",
  "nav.graph": "Grafo",
  "nav.agents": "Agentes",
  "nav.marketplace": "Marketplace",
  "nav.integrations": "Integraciones",
  "nav.settings": "Ajustes",
  "nav.pending": "pendientes",
  "nav.running": "en curso",
  "top.providers": "Proveedores",
  "top.integrations": "Integraciones",
  "top.members": "Miembros",
  "top.privacy": "Datos y privacidad",
  "top.inbox": "Bandeja",
  "top.inboxLong": "Bandeja: todo lo que te espera",
  "top.account": "Cuenta",
  "top.accountLong": "Cuenta y privacidad",
  "top.system": "Sistema",
  "top.signOut": "Salir",
  "account.language": "Idioma",
  "account.languageHelp": "La navegación del espacio de trabajo se lee en este idioma; el resto llega a medida que crece el catálogo.",
  "account.languageSaved": "Guardado. Recargando en tu idioma.",
};

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, es };

export function t(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale][key] ?? en[key];
}
