/** Match the schedule API: triggering requires member, editing requires admin. */
export function scheduleAccess(role: string | undefined) {
  return { edit: role === "owner" || role === "admin", trigger: ["owner", "admin", "member"].includes(role ?? "") };
}
