import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local server that answers the way GitHub's REST API does, for the handful of endpoints this product reads.
 *
 * It exists so the code IDE's tests can drive the *real* `GitHubClient` — the real URL building, the real base64
 * decoding, the real error mapping — instead of a stubbed client that would pass whether or not the client works.
 * Pointing a client at a local server is not a trick: it is what the integration's own `baseUrl` field is for
 * (GitHub Enterprise), so the test uses the same seam a self-hosted customer uses.
 *
 * The requests it received are recorded, because "what did we actually ask GitHub for" is worth asserting: a read
 * at the base ref and a read at the wrong ref look identical in the result.
 */
export interface FakeGitHub {
  url: string;
  requests: Array<{ method: string; path: string; search: string; authorization: string | null }>;
  /** The files the server will serve, keyed by path. Mutating this mid-test is a new commit, from the outside. */
  files: Map<string, string>;
  close(): Promise<void>;
}

export async function startFakeGitHub(input: { repo?: string; defaultBranch?: string; files?: Record<string, string>; truncated?: boolean; binary?: string } = {}): Promise<FakeGitHub> {
  const repo = input.repo ?? "northwind/analytics";
  const defaultBranch = input.defaultBranch ?? "main";
  const files = new Map<string, string>(Object.entries(input.files ?? {}));
  const requests: FakeGitHub["requests"] = [];
  if (input.binary) files.set(input.binary, "PNG\u0000\u0001binary");

  const send = (res: ServerResponse, status: number, body: unknown) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  };

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ method: req.method ?? "GET", path: url.pathname, search: url.search, authorization: req.headers.authorization ?? null });
    const path = decodeURIComponent(url.pathname);
    const [, area, owner, name, ...rest] = path.split("/");
    if (area === "user" && owner === "repos") {
      return send(res, 200, [{ full_name: repo, private: true, default_branch: defaultBranch, html_url: `https://github.com/${repo}`, description: null, pushed_at: new Date().toISOString() }]);
    }
    if (area !== "repos" || !owner || !name) return send(res, 404, { message: "Not Found" });
    if (rest.length === 0) {
      return send(res, 200, { full_name: `${owner}/${name}`, default_branch: defaultBranch, private: true, html_url: `https://github.com/${owner}/${name}`, clone_url: `https://github.com/${owner}/${name}.git` });
    }
    if (rest[0] === "branches") {
      return send(res, 200, [
        { name: defaultBranch, protected: true, commit: { sha: "sha-main" } },
        { name: "feature/one", protected: false, commit: { sha: "sha-feature" } },
      ]);
    }
    if (rest[0] === "git" && rest[1] === "trees") {
      return send(res, 200, {
        sha: "sha-main",
        truncated: input.truncated ?? false,
        tree: [...files.keys()].map((file) => ({ path: file, mode: "100644", type: "blob" as const, size: Buffer.byteLength(files.get(file) ?? "", "utf8"), sha: `sha-${file}` })),
      });
    }
    if (rest[0] === "contents") {
      const file = rest.slice(1).join("/");
      const contents = files.get(file);
      if (contents === undefined) return send(res, 404, { message: "Not Found" });
      return send(res, 200, { content: Buffer.from(contents, "utf8").toString("base64"), encoding: "base64", sha: `sha-${file}` });
    }
    return send(res, 404, { message: "Not Found" });
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    files,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
