import type { Approval, Run } from "./types";
import type { Locale } from "./i18n";
import { decisionCopy } from "./decision-copy";
import { isDecisionOpen, isRunClosed } from "./decision-semantics";

export type ApprovalContext = { taskTitle: string | null; runIntent: string | null; runStatus?: Run["status"] | null; unavailable?: boolean };

/** A still-pending database row is not a decision to make after its linked run has ended. */
export function approvalRowState(approval: Approval, context: Pick<ApprovalContext, "runStatus"> | undefined, locale: Locale, now = Date.now()) {
  const c = decisionCopy(locale);
  const run = context?.runStatus ? { status: context.runStatus } : undefined;
  const open = isDecisionOpen(approval, now, run);
  const status = approval.status === "pending" ? run?.status === "cancelled" ? "cancelled" : isRunClosed(run) ? "closed" : open ? "pending" : "expired" : approval.status;
  return { open, status, label: status === "closed" ? c.closed : status === "expired" ? c.expiredStatus : c[status] };
}

export const approvalContextUnavailable = (locale: Locale) => locale === "es" ? "No se pudieron cargar algunos nombres vinculados. Usa la referencia guardada para consultar la solicitud y su trabajo vinculado." : "Some linked work names could not be loaded. Use the recorded reference to inspect the request and its linked work.";

/** A row names recorded work, never a title inferred from a tool or policy dimension. */
export function approvalWorkLabel(approval: Approval, context: ApprovalContext | undefined, locale: Locale): string {
  const es = locale === "es";
  if (context?.taskTitle?.trim()) return `${es ? "Tarea" : "Task"}: ${context.taskTitle}`;
  const intent = context?.runIntent?.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (intent) return `${es ? "Ejecución" : "Run"}: ${intent}`;
  const ref = approval.runId ? `${es ? "Ejecución" : "Run"} ${approval.runId.slice(0, 8)}` : approval.taskId ? `${es ? "Tarea" : "Task"} ${approval.taskId.slice(0, 8)}` : null;
  return ref ? `${ref} · ${es ? "nombre no disponible" : "name not available"}` : es ? "Sin tarea ni ejecución vinculada" : "No linked task or run";
}

/** Interpret only known payload fields. Typed text stays in the exact-payload review. */
function describeApprovalAction(approval: Approval, locale: Locale): string {
  const es = locale === "es";
  const p = approval.payload;
  const str = (key: string) => typeof p[key] === "string" ? (p[key] as string).trim() : "";
  if (approval.action === "browser.act") {
    switch (str("kind")) {
      case "wait": {
        if (typeof p.ms !== "number" || !Number.isFinite(p.ms) || p.ms < 0) break;
        const seconds = p.ms / 1000;
        const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(seconds);
        return es ? `Esperar ${value} ${seconds === 1 ? "segundo" : "segundos"} en el navegador` : `Wait ${value} ${seconds === 1 ? "second" : "seconds"} in the browser`;
      }
      case "click": if (str("selector")) return `${es ? "Hacer clic en" : "Click"} ${str("selector")}`; break;
      case "type": if (str("selector")) return `${es ? "Escribir en" : "Type into"} ${str("selector")}${p.submit === true ? es ? " y pulsar Enter" : " and press Enter" : ""}`; break;
      case "select": if (str("selector")) return `${es ? "Elegir una opción en" : "Choose an option in"} ${str("selector")}`; break;
      case "press": if (str("key")) return `${es ? "Pulsar" : "Press"} ${str("key")}`; break;
      case "scroll": {
        const directions: Record<string, [string, string]> = { top: ["to the top", "al inicio"], bottom: ["to the bottom", "al final"], up: ["up", "hacia arriba"], down: ["down", "hacia abajo"] };
        const direction = directions[str("to")];
        if (direction) return es ? `Desplazarse ${direction[1]}` : `Scroll ${direction[0]}`;
        break;
      }
      case "back": return es ? "Volver a la página anterior" : "Go back to the previous page";
    }
    return es ? "Revisar acción del navegador" : "Review browser action";
  }
  if (approval.action === "email.send") return `${es ? "Enviar correo" : "Send email"}${str("to") ? ` ${es ? "a" : "to"} ${str("to")}` : ""}${str("subject") ? ` · ${str("subject")}` : ""}`;
  if (approval.action === "sms.send") return `${es ? "Enviar mensaje de texto" : "Send text message"}${str("to") ? ` ${es ? "a" : "to"} ${str("to")}` : ""}`;
  if (approval.action === "social.publish") return `${es ? "Publicar" : "Publish post"}${str("network") ? ` ${es ? "en" : "on"} ${str("network")}` : ""}`;
  return `${es ? "Revisar acción" : "Review action"}: ${approval.action}`;
}

/** Rows are previews, not the exact payload: visibly abbreviate long selectors/subjects at 140 characters. */
export function approvalActionLabel(approval: Approval, locale: Locale): string {
  const characters = Array.from(describeApprovalAction(approval, locale));
  return characters.length > 140 ? `${characters.slice(0, 139).join("").trimEnd()}…` : characters.join("");
}
