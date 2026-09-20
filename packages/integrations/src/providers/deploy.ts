import { apiJson, type IntegrationDefinition, type IntegrationSecret } from "../framework.js";

export interface DeployProvider {
  id: string;
  listProjects(): Promise<Array<{ id: string; name: string; url?: string; framework?: string }>>;
  createProject(input: { name: string; repo?: { provider: "github"; fullName: string; branch?: string }; framework?: string; rootDirectory?: string }): Promise<{ id: string; name: string; url?: string }>;
  setEnv(projectId: string, vars: Array<{ key: string; value: string; target?: ("production" | "preview" | "development")[] }>): Promise<void>;
  deploy(projectId: string, input: { branch?: string; production: boolean; ref?: string }): Promise<{ id: string; url?: string; status: string }>;
  getDeployment(id: string): Promise<{ id: string; status: "queued" | "building" | "ready" | "error" | "canceled"; url?: string; error?: string }>;
  getLogs?(id: string, limit?: number): Promise<string>;
}

export const vercelDefinition: IntegrationDefinition = {
  id: "vercel",
  name: "Vercel",
  category: "deploy",
  authKind: "token",
  fields: [
    { key: "token", label: "Vercel access token", secret: true, help: "Create at vercel.com/account/tokens; scope to a single team if possible." },
    { key: "teamId", label: "Team ID (optional)", secret: false, placeholder: "team_…" },
  ],
  docsUrl: "https://vercel.com/docs/rest-api",
  actions: [
    { name: "list_projects", description: "List projects", risk: "LOW", externallyVisible: false },
    { name: "create_project", description: "Create a project linked to a repository", risk: "MEDIUM", dimension: "infra_spend", externallyVisible: true },
    { name: "deploy_preview", description: "Create a preview deployment", risk: "MEDIUM", dimension: "code_deploy", externallyVisible: true },
    { name: "deploy_production", description: "Create a production deployment", risk: "HIGH", dimension: "prod_deploy", externallyVisible: true },
    { name: "set_env", description: "Set environment variables", risk: "MEDIUM", dimension: "external_write", externallyVisible: false },
  ],
  webhook: { signatureHeader: "x-vercel-signature", scheme: "hmac_sha256_hex" },
  status: "implemented",
};

export class VercelProvider implements DeployProvider {
  readonly id = "vercel";
  private readonly token: string;
  private readonly teamId?: string;
  constructor(secret: IntegrationSecret) {
    this.token = secret.fields?.token ?? secret.accessToken ?? "";
    this.teamId = secret.fields?.teamId || undefined;
  }
  private url(path: string, extra: Record<string, string> = {}) {
    const u = new URL(`https://api.vercel.com${path}`);
    if (this.teamId) u.searchParams.set("teamId", this.teamId);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return u.toString();
  }
  private req<T>(path: string, init: RequestInit = {}, extra?: Record<string, string>) {
    return apiJson<T>("vercel", this.url(path, extra), { ...init, headers: { authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string> | undefined) } });
  }
  async listProjects() {
    const j = await this.req<{ projects: Array<{ id: string; name: string; framework?: string; targets?: { production?: { alias?: string[] } } }> }>("/v10/projects", {}, { limit: "50" });
    return j.projects.map((p) => ({ id: p.id, name: p.name, framework: p.framework, url: p.targets?.production?.alias?.[0] ? `https://${p.targets.production.alias[0]}` : undefined }));
  }
  async createProject(input: { name: string; repo?: { provider: "github"; fullName: string; branch?: string }; framework?: string; rootDirectory?: string }) {
    const body: Record<string, unknown> = { name: input.name, framework: input.framework ?? null, rootDirectory: input.rootDirectory ?? null };
    if (input.repo) body.gitRepository = { type: "github", repo: input.repo.fullName, productionBranch: input.repo.branch };
    const p = await this.req<{ id: string; name: string }>("/v11/projects", { method: "POST", body: JSON.stringify(body) });
    return { id: p.id, name: p.name, url: `https://${p.name}.vercel.app` };
  }
  async setEnv(projectId: string, vars: Array<{ key: string; value: string; target?: ("production" | "preview" | "development")[] }>) {
    await this.req(`/v10/projects/${projectId}/env`, { method: "POST", body: JSON.stringify(vars.map((v) => ({ key: v.key, value: v.value, type: "encrypted", target: v.target ?? ["production", "preview", "development"] }))) }, { upsert: "true" });
  }
  async deploy(projectId: string, input: { branch?: string; production: boolean; ref?: string }) {
    const project = await this.req<{ name: string; link?: { type: string; repoId?: number; org?: string; repo?: string; productionBranch?: string } }>(`/v9/projects/${projectId}`);
    if (!project.link?.repoId) throw new Error("Project has no linked Git repository; connect a repo first");
    const d = await this.req<{ id: string; url: string; readyState: string }>("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({ name: project.name, project: projectId, target: input.production ? "production" : undefined, gitSource: { type: "github", repoId: project.link.repoId, ref: input.ref ?? input.branch ?? project.link.productionBranch ?? "main" } }),
    }, { forceNew: "1" });
    return { id: d.id, url: `https://${d.url}`, status: d.readyState.toLowerCase() };
  }
  async getDeployment(id: string) {
    const d = await this.req<{ id: string; url: string; readyState: string; errorMessage?: string }>(`/v13/deployments/${id}`);
    const map: Record<string, "queued" | "building" | "ready" | "error" | "canceled"> = { QUEUED: "queued", INITIALIZING: "building", BUILDING: "building", READY: "ready", ERROR: "error", CANCELED: "canceled" };
    return { id: d.id, status: map[d.readyState] ?? "building", url: `https://${d.url}`, error: d.errorMessage };
  }
  async getLogs(id: string, limit = 200) {
    const events = await this.req<Array<{ type: string; payload?: { text?: string } }>>(`/v3/deployments/${id}/events`, {}, { limit: String(limit) });
    return events.map((e) => e.payload?.text ?? "").filter(Boolean).join("\n");
  }
}

export const renderDefinition: IntegrationDefinition = {
  id: "render",
  name: "Render",
  category: "deploy",
  authKind: "api_key",
  fields: [
    { key: "apiKey", label: "Render API key", secret: true },
    { key: "ownerId", label: "Owner/workspace ID", secret: false, placeholder: "tea-… or usr-…" },
  ],
  docsUrl: "https://api-docs.render.com/",
  actions: [
    { name: "list_services", description: "List services", risk: "LOW", externallyVisible: false },
    { name: "create_service", description: "Create a web service from a repo (may incur cost)", risk: "HIGH", dimension: "infra_spend", externallyVisible: true },
    { name: "deploy", description: "Trigger a deploy", risk: "HIGH", dimension: "prod_deploy", externallyVisible: true },
  ],
  status: "implemented",
};

export class RenderProvider implements DeployProvider {
  readonly id = "render";
  private readonly key: string;
  private readonly ownerId?: string;
  constructor(secret: IntegrationSecret) {
    this.key = secret.fields?.apiKey ?? "";
    this.ownerId = secret.fields?.ownerId || undefined;
  }
  private req<T>(path: string, init: RequestInit = {}) {
    return apiJson<T>("render", `https://api.render.com/v1${path}`, { ...init, headers: { authorization: `Bearer ${this.key}`, ...(init.headers as Record<string, string> | undefined) } });
  }
  async listProjects() {
    const j = await this.req<Array<{ service: { id: string; name: string; serviceDetails?: { url?: string }; type: string } }>>("/services?limit=50");
    return j.map((x) => ({ id: x.service.id, name: x.service.name, url: x.service.serviceDetails?.url, framework: x.service.type }));
  }
  async createProject(input: { name: string; repo?: { provider: "github"; fullName: string; branch?: string }; rootDirectory?: string }) {
    if (!input.repo) throw new Error("Render services require a repository");
    const s = await this.req<{ service: { id: string; name: string; serviceDetails?: { url?: string } } }>("/services", {
      method: "POST",
      body: JSON.stringify({ type: "web_service", name: input.name, ownerId: this.ownerId, repo: `https://github.com/${input.repo.fullName}`, branch: input.repo.branch ?? "main", autoDeploy: "yes", rootDir: input.rootDirectory, serviceDetails: { env: "node", plan: "starter", region: "oregon", envSpecificDetails: { buildCommand: "npm install && npm run build", startCommand: "npm start" } } }),
    });
    return { id: s.service.id, name: s.service.name, url: s.service.serviceDetails?.url };
  }
  async setEnv(projectId: string, vars: Array<{ key: string; value: string }>) {
    await this.req(`/services/${projectId}/env-vars`, { method: "PUT", body: JSON.stringify(vars.map((v) => ({ key: v.key, value: v.value }))) });
  }
  async deploy(projectId: string) {
    const d = await this.req<{ id: string; status: string }>(`/services/${projectId}/deploys`, { method: "POST", body: JSON.stringify({ clearCache: "do_not_clear" }) });
    return { id: `${projectId}:${d.id}`, status: d.status };
  }
  async getDeployment(id: string) {
    const [serviceId, deployId] = id.split(":");
    const d = await this.req<{ id: string; status: string }>(`/services/${serviceId}/deploys/${deployId}`);
    const map: Record<string, "queued" | "building" | "ready" | "error" | "canceled"> = { created: "queued", queued: "queued", build_in_progress: "building", update_in_progress: "building", live: "ready", deactivated: "canceled", build_failed: "error", update_failed: "error", canceled: "canceled", pre_deploy_in_progress: "building", pre_deploy_failed: "error" };
    return { id, status: map[d.status] ?? "building" };
  }
}
