export function runsHref(companyId: string, status?: string, taskId?: string) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (taskId) params.set("taskId", taskId);
  return `/app/c/${companyId}/runs${params.size ? `?${params}` : ""}`;
}
