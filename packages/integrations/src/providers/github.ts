import { apiJson, type IntegrationDefinition, type IntegrationSecret } from "../framework.js";

export const githubDefinition: IntegrationDefinition = {
  id: "github",
  name: "GitHub",
  category: "source_control",
  authKind: "oauth2",
  oauth: { authorizeUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", scopes: ["repo", "read:user", "user:email"], pkce: false, clientAuth: "body" },
  fields: [{ key: "token", label: "Personal access token (fine-grained; Contents + Pull requests: read/write)", secret: true, placeholder: "github_pat_…", help: "Used when OAuth is not configured." }],
  docsUrl: "https://docs.github.com/en/rest",
  actions: [
    { name: "list_repos", description: "List repositories", risk: "LOW", externallyVisible: false },
    { name: "read_file", description: "Read repository file", risk: "LOW", externallyVisible: false },
    { name: "create_branch", description: "Create branch", risk: "LOW", dimension: "external_write", externallyVisible: true },
    { name: "commit_files", description: "Commit files to a branch", risk: "MEDIUM", dimension: "external_write", externallyVisible: true },
    { name: "create_pull_request", description: "Open a pull request", risk: "MEDIUM", dimension: "external_write", externallyVisible: true },
    { name: "create_issue", description: "Create an issue", risk: "MEDIUM", dimension: "external_write", externallyVisible: true },
    { name: "merge_pull_request", description: "Merge a pull request", risk: "HIGH", dimension: "code_deploy", externallyVisible: true },
  ],
  webhook: { signatureHeader: "x-hub-signature-256", scheme: "hmac_sha256_hex" },
  status: "implemented",
};

export interface RepoRef {
  owner: string;
  repo: string;
}

export class GitHubClient {
  private readonly base: string;
  constructor(private readonly secret: IntegrationSecret, baseUrl = "https://api.github.com") {
    this.base = baseUrl.replace(/\/$/, "");
  }
  static fromSecret(s: IntegrationSecret, baseUrl?: string) {
    return new GitHubClient(s, baseUrl);
  }
  private get token() {
    return this.secret.accessToken ?? this.secret.fields?.token ?? "";
  }
  private headers() {
    return { authorization: `Bearer ${this.token}`, "x-github-api-version": "2022-11-28", "user-agent": "steward" };
  }
  private req<T>(path: string, init: RequestInit = {}) {
    return apiJson<T>("github", `${this.base}${path}`, { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) } });
  }

  me() {
    return this.req<{ login: string; id: number; type: string }>("/user");
  }
  listRepos(opts: { perPage?: number; affiliation?: string } = {}) {
    return this.req<Array<{ full_name: string; private: boolean; default_branch: string; html_url: string; description: string | null; pushed_at: string }>>(`/user/repos?per_page=${opts.perPage ?? 50}&sort=pushed&affiliation=${opts.affiliation ?? "owner,collaborator,organization_member"}`);
  }
  getRepo(r: RepoRef) {
    return this.req<{ full_name: string; default_branch: string; private: boolean; html_url: string; clone_url: string }>(`/repos/${r.owner}/${r.repo}`);
  }
  async createRepo(input: { name: string; description?: string; private?: boolean; org?: string; autoInit?: boolean }) {
    const path = input.org ? `/orgs/${input.org}/repos` : "/user/repos";
    return this.req<{ full_name: string; html_url: string; clone_url: string; default_branch: string }>(path, { method: "POST", body: JSON.stringify({ name: input.name, description: input.description, private: input.private ?? true, auto_init: input.autoInit ?? true }) });
  }
  async getRef(r: RepoRef, branch: string) {
    return this.req<{ object: { sha: string } }>(`/repos/${r.owner}/${r.repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  }
  async createBranch(r: RepoRef, branch: string, fromBranch?: string) {
    const repo = fromBranch ? undefined : await this.getRepo(r);
    const base = await this.getRef(r, fromBranch ?? repo!.default_branch);
    return this.req<{ ref: string; object: { sha: string } }>(`/repos/${r.owner}/${r.repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }) });
  }
  async readFile(r: RepoRef, path: string, ref?: string): Promise<{ content: string; sha: string }> {
    const res = await this.req<{ content: string; encoding: string; sha: string }>(`/repos/${r.owner}/${r.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
    return { content: Buffer.from(res.content, "base64").toString("utf8"), sha: res.sha };
  }
  /** Commits multiple files atomically via the Git Data API (tree + commit + ref update). */
  async commitFiles(r: RepoRef, input: { branch: string; message: string; files: Array<{ path: string; content: string | null }>; author?: { name: string; email: string } }) {
    const ref = await this.getRef(r, input.branch);
    const headSha = ref.object.sha;
    const head = await this.req<{ tree: { sha: string } }>(`/repos/${r.owner}/${r.repo}/git/commits/${headSha}`);
    const tree = await this.req<{ sha: string }>(`/repos/${r.owner}/${r.repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: head.tree.sha, tree: input.files.map((f) => (f.content === null ? { path: f.path, mode: "100644", type: "blob", sha: null } : { path: f.path, mode: "100644", type: "blob", content: f.content })) }),
    });
    const commit = await this.req<{ sha: string; html_url: string }>(`/repos/${r.owner}/${r.repo}/git/commits`, { method: "POST", body: JSON.stringify({ message: input.message, tree: tree.sha, parents: [headSha], ...(input.author ? { author: input.author } : {}) }) });
    await this.req(`/repos/${r.owner}/${r.repo}/git/refs/heads/${encodeURIComponent(input.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    return commit;
  }
  createPullRequest(r: RepoRef, input: { title: string; head: string; base: string; body?: string; draft?: boolean }) {
    return this.req<{ number: number; html_url: string; state: string }>(`/repos/${r.owner}/${r.repo}/pulls`, { method: "POST", body: JSON.stringify(input) });
  }
  listPullRequests(r: RepoRef, state: "open" | "closed" | "all" = "open") {
    return this.req<Array<{ number: number; title: string; html_url: string; state: string; head: { ref: string }; user: { login: string }; updated_at: string }>>(`/repos/${r.owner}/${r.repo}/pulls?state=${state}&per_page=30`);
  }
  mergePullRequest(r: RepoRef, number: number, method: "merge" | "squash" | "rebase" = "squash") {
    return this.req<{ merged: boolean; sha: string }>(`/repos/${r.owner}/${r.repo}/pulls/${number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: method }) });
  }
  createIssue(r: RepoRef, input: { title: string; body?: string; labels?: string[] }) {
    return this.req<{ number: number; html_url: string }>(`/repos/${r.owner}/${r.repo}/issues`, { method: "POST", body: JSON.stringify(input) });
  }
  listIssues(r: RepoRef, state: "open" | "closed" | "all" = "open") {
    return this.req<Array<{ number: number; title: string; html_url: string; state: string; labels: Array<{ name: string }>; pull_request?: unknown }>>(`/repos/${r.owner}/${r.repo}/issues?state=${state}&per_page=50`);
  }
  commentOnIssue(r: RepoRef, number: number, body: string) {
    return this.req<{ id: number; html_url: string }>(`/repos/${r.owner}/${r.repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  }
  /** URL usable by the sandbox `git` client (token embedded; never logged or shown to the model). */
  cloneUrl(r: RepoRef) {
    return `https://x-access-token:${this.token}@github.com/${r.owner}/${r.repo}.git`;
  }
}
