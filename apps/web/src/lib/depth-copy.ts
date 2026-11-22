import type { Locale } from "./i18n";

const en = {
  teamTitle: "A team with clear boundaries.", teamIntro: "Choose who works on what. Keep their authority visible.",
  agents: "Agents", map: "Team map", mapHint: "Grouped by configured role, not reporting relationships. These are AI agents, not human members.",
  coordinator: "Coordination", specialists: "Specialists", searchAgents: "Search agents", searchHint: "Name, role or capability", noAgents: "No agents in this view", clear: "Clear search",
  enabled: "Enabled", disabled: "Disabled", enabledHint: "Enabled is configuration, not worker health. Activity comes from the latest 100 run records.",
  activity: "Latest recorded run", noActivity: "No run in the latest 100 records", unavailable: "Not available", tools: "Allowed tools", noTools: "No allowed tools", budget: "Budget limit per run", limitHint: "Configured limit in USD, not recorded spend or a balance.",
  authority: "Company authority", policy: "Inspect policies and limits", instructions: "Instructions and capabilities", edit: "Edit agent", history: "Inspect run history", readOnly: "Only organization owners and admins can change agent configuration or schedules.",
  knowledgeTitle: "Context that stays with the company.", knowledgeIntro: "Documents and memory your team can use, with provenance visible.", scope: "Company-scoped knowledge", scopeHint: "Changes apply to this company. Documents keep version history; memory keeps its provenance and revisions.",
  sourcesHint: "Search the loaded records: up to 100 memories, decisions and artifacts. This is not a full-archive search.", searchSources: "Search this collection", connections: "Connections", documents: "Documents", memory: "Memory", source: "Source", updated: "Updated", author: "Author", noMatches: "No matching records. Try another search or clear it.",
  membersTitle: "People in your organization.", membersIntro: "Human membership is separate from the company's AI team. Roles apply across this organization.", organization: "Organization", members: "Members", invitations: "Invitations", inviteHint: "Owners and admins can invite people. Only owners can change roles or remove other members.",
  loading: "Loading records…", failed: "These records could not be loaded. Nothing here has been replaced with an empty list.", denied: "Your membership does not allow access to these records.", retry: "Refresh records", partial: "Some context could not be loaded. Missing activity or authority is not evidence of inactivity or permission.",
  graphTitle: "Connections, with a source.", graphIntro: "Explore the company's records and recorded claims. Every connection keeps its provenance.",
};
const es: typeof en = {
  teamTitle: "Un equipo con límites claros.", teamIntro: "Elige quién hace qué. Mantén visible su autoridad.",
  agents: "Agentes", map: "Mapa del equipo", mapHint: "Agrupados por función configurada, no por jerarquía. Son agentes de IA, no miembros humanos.",
  coordinator: "Coordinación", specialists: "Especialistas", searchAgents: "Buscar agentes", searchHint: "Nombre, función o capacidad", noAgents: "No hay agentes en esta vista", clear: "Borrar búsqueda",
  enabled: "Habilitado", disabled: "Deshabilitado", enabledHint: "Habilitado es una configuración, no el estado del proceso. La actividad procede de las últimas 100 ejecuciones.",
  activity: "Última ejecución registrada", noActivity: "Sin ejecución entre los últimos 100 registros", unavailable: "No disponible", tools: "Herramientas permitidas", noTools: "Sin herramientas permitidas", budget: "Límite de presupuesto por ejecución", limitHint: "Límite configurado en USD, no gasto registrado ni saldo.",
  authority: "Autoridad de la empresa", policy: "Ver políticas y límites", instructions: "Instrucciones y capacidades", edit: "Editar agente", history: "Ver historial de ejecuciones", readOnly: "Solo los propietarios y administradores pueden cambiar agentes o programaciones.",
  knowledgeTitle: "Contexto que permanece en la empresa.", knowledgeIntro: "Documentos y memoria para tu equipo, con procedencia visible.", scope: "Conocimiento de esta empresa", scopeHint: "Los cambios se aplican a esta empresa. Los documentos conservan versiones; la memoria, su procedencia y revisiones.",
  sourcesHint: "Busca en los registros cargados: hasta 100 memorias, decisiones y artefactos. No es una búsqueda del archivo completo.", searchSources: "Buscar en esta colección", connections: "Conexiones", documents: "Documentos", memory: "Memoria", source: "Fuente", updated: "Actualizado", author: "Autor", noMatches: "No hay coincidencias. Prueba otra búsqueda o bórrala.",
  membersTitle: "Las personas de tu organización.", membersIntro: "Los miembros humanos son distintos del equipo de IA. Sus funciones se aplican a toda la organización.", organization: "Organización", members: "Miembros", invitations: "Invitaciones", inviteHint: "Los propietarios y administradores pueden invitar. Solo los propietarios pueden cambiar funciones o eliminar otros miembros.",
  loading: "Cargando registros…", failed: "No se pudieron cargar estos registros. No se han sustituido por listas vacías.", denied: "Tu membresía no permite acceder a estos registros.", retry: "Actualizar registros", partial: "No se pudo cargar parte del contexto. La falta de actividad o autoridad no indica inactividad ni permiso.",
  graphTitle: "Conexiones con procedencia.", graphIntro: "Explora registros y afirmaciones de la empresa. Cada conexión conserva su procedencia.",
};
export function depthCopy(locale: Locale) { return locale === "es" ? es : en; }
