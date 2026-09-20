import { PassThrough } from "node:stream";
import Docker from "dockerode";
import tar from "tar-stream";

export interface SandboxSpec {
  /** Stable id used for container naming (e.g. run id). */
  id: string;
  image?: string;
  cpus?: number;
  memoryMb?: number;
  pidsLimit?: number;
  /** none | egress (default egress through host network with no privileged capabilities). */
  network?: "none" | "egress";
  env?: Record<string, string>;
  workdir?: string;
  labels?: Record<string, string>;
  /** Max wall-clock lifetime; container is killed afterwards. */
  ttlSeconds?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface Sandbox {
  readonly id: string;
  exec(cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; stdin?: string; maxOutputBytes?: number; signal?: AbortSignal }): Promise<ExecResult>;
  writeFile(path: string, content: string | Buffer, mode?: number): Promise<void>;
  writeFiles(files: Array<{ path: string; content: string | Buffer; mode?: number }>): Promise<void>;
  readFile(path: string, maxBytes?: number): Promise<Buffer>;
  listFiles(path: string, opts?: { maxDepth?: number; limit?: number }): Promise<string[]>;
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  create(spec: SandboxSpec): Promise<Sandbox>;
  get(id: string): Promise<Sandbox | null>;
  reapExpired(): Promise<number>;
}

export const DEFAULT_SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "steward/sandbox:latest";
export const FALLBACK_SANDBOX_IMAGE = "node:22-bookworm";

function demux(stream: NodeJS.ReadableStream, docker: Docker, maxBytes: number): { stdout: PassThrough; stderr: PassThrough; done: Promise<{ stdout: string; stderr: string }> } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  stdout.on("data", (c: Buffer) => {
    if (outBytes < maxBytes) {
      outChunks.push(c.subarray(0, maxBytes - outBytes));
      outBytes += c.length;
    }
  });
  stderr.on("data", (c: Buffer) => {
    if (errBytes < maxBytes) {
      errChunks.push(c.subarray(0, maxBytes - errBytes));
      errBytes += c.length;
    }
  });
  docker.modem.demuxStream(stream, stdout, stderr);
  const done = new Promise<{ stdout: string; stderr: string }>((resolve) => {
    stream.on("end", () => {
      stdout.end();
      stderr.end();
      const trunc = (chunks: Buffer[], bytes: number) => Buffer.concat(chunks).toString("utf8") + (bytes > maxBytes ? `\n…[truncated ${bytes - maxBytes} bytes]` : "");
      resolve({ stdout: trunc(outChunks, outBytes), stderr: trunc(errChunks, errBytes) });
    });
  });
  return { stdout, stderr, done };
}

export class DockerSandbox implements Sandbox {
  constructor(readonly id: string, private readonly docker: Docker, private readonly container: Docker.Container, readonly workdir: string) {}

  async exec(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; stdin?: string; maxOutputBytes?: number; signal?: AbortSignal } = {}): Promise<ExecResult> {
    const started = Date.now();
    const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
    const exec = await this.container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: opts.stdin !== undefined,
      WorkingDir: opts.cwd ?? this.workdir,
      Env: Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${v}`),
      User: "1000:1000",
    });
    const stream = await exec.start({ hijack: true, stdin: opts.stdin !== undefined });
    if (opts.stdin !== undefined) {
      stream.write(opts.stdin);
      stream.end();
    }
    const { done } = demux(stream, this.docker, opts.maxOutputBytes ?? 512 * 1024);
    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      try {
        // Kill the exec'd process tree by pid lookup inside the container.
        const info = await exec.inspect();
        if (info.Pid) await this.container.exec({ Cmd: ["sh", "-c", `kill -9 -- -${info.Pid} ${info.Pid} 2>/dev/null || true`], User: "0" }).then((e) => e.start({}));
      } catch {
        /* container may already be gone */
      }
      stream.destroy();
    }, timeoutMs);
    const onAbort = () => {
      timedOut = true;
      stream.destroy();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const { stdout, stderr } = await done;
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    const info = await exec.inspect().catch(() => ({ ExitCode: 137 }));
    return { exitCode: timedOut ? 124 : (info.ExitCode ?? 1), stdout, stderr, durationMs: Date.now() - started, timedOut };
  }

  async writeFiles(files: Array<{ path: string; content: string | Buffer; mode?: number }>): Promise<void> {
    const pack = tar.pack();
    for (const f of files) {
      const rel = f.path.startsWith("/") ? f.path.slice(1) : f.path;
      pack.entry({ name: rel, mode: f.mode ?? 0o644, uid: 1000, gid: 1000 }, typeof f.content === "string" ? Buffer.from(f.content, "utf8") : f.content);
    }
    pack.finalize();
    await this.container.putArchive(pack as unknown as NodeJS.ReadableStream, { path: "/" });
  }

  async writeFile(path: string, content: string | Buffer, mode?: number): Promise<void> {
    const abs = path.startsWith("/") ? path : `${this.workdir}/${path}`;
    return this.writeFiles([{ path: abs, content, mode }]);
  }

  async readFile(path: string, maxBytes = 2 * 1024 * 1024): Promise<Buffer> {
    const abs = path.startsWith("/") ? path : `${this.workdir}/${path}`;
    const stream = await this.container.getArchive({ path: abs });
    return new Promise<Buffer>((resolve, reject) => {
      const extract = tar.extract();
      let result: Buffer | undefined;
      extract.on("entry", (_header, s, next) => {
        const chunks: Buffer[] = [];
        let total = 0;
        s.on("data", (c: unknown) => {
          const buf = c as Buffer;
          total += buf.length;
          if (total <= maxBytes) chunks.push(buf);
        });
        s.on("end", () => {
          if (!result) result = Buffer.concat(chunks);
          next();
        });
        s.resume();
      });
      extract.on("finish", () => resolve(result ?? Buffer.alloc(0)));
      extract.on("error", reject);
      stream.on("error", reject);
      stream.pipe(extract);
    });
  }

  async listFiles(path: string, opts: { maxDepth?: number; limit?: number } = {}): Promise<string[]> {
    const abs = path.startsWith("/") ? path : `${this.workdir}/${path}`;
    const res = await this.exec(["sh", "-c", `find ${JSON.stringify(abs)} -maxdepth ${opts.maxDepth ?? 3} -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | head -n ${opts.limit ?? 500}`], { timeoutMs: 30_000 });
    return res.stdout.split("\n").filter(Boolean);
  }

  async destroy(): Promise<void> {
    try {
      await this.container.remove({ force: true, v: true });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
  }
}

/**
 * Runs each sandbox as an unprivileged Docker container with dropped capabilities, no host mounts, resource limits
 * and an expiry label. Suitable for self-hosting; production should point DOCKER_HOST at a dedicated sandbox host.
 */
export class LocalDockerSandboxProvider implements SandboxProvider {
  private readonly docker: Docker;
  constructor(opts: { socketPath?: string; host?: string; port?: number } = {}) {
    this.docker = opts.host ? new Docker({ host: opts.host, port: opts.port ?? 2375 }) : new Docker({ socketPath: opts.socketPath ?? process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
  }

  static containerName(id: string) {
    return `steward-sbx-${id.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 50)}`;
  }

  async ensureImage(image: string): Promise<string> {
    try {
      await this.docker.getImage(image).inspect();
      return image;
    } catch {
      /* not present locally */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
        });
      });
      return image;
    } catch (e) {
      if (image !== FALLBACK_SANDBOX_IMAGE) return this.ensureImage(FALLBACK_SANDBOX_IMAGE);
      throw e;
    }
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const image = await this.ensureImage(spec.image ?? DEFAULT_SANDBOX_IMAGE);
    const workdir = spec.workdir ?? "/workspace";
    const expiresAt = Date.now() + (spec.ttlSeconds ?? 2 * 3600) * 1000;
    const name = LocalDockerSandboxProvider.containerName(spec.id);
    const existing = await this.get(spec.id);
    if (existing) await existing.destroy();
    const container = await this.docker.createContainer({
      name,
      Image: image,
      Cmd: ["sh", "-c", "mkdir -p /workspace && chown 1000:1000 /workspace && exec sleep infinity"],
      WorkingDir: workdir,
      Env: Object.entries({ HOME: "/home/sandbox", CI: "1", ...(spec.env ?? {}) }).map(([k, v]) => `${k}=${v}`),
      Labels: { "steward.sandbox": "1", "steward.sandbox.id": spec.id, "steward.sandbox.expires": String(expiresAt), ...(spec.labels ?? {}) },
      Tty: false,
      HostConfig: {
        NanoCpus: Math.round((spec.cpus ?? 2) * 1e9),
        Memory: (spec.memoryMb ?? 4096) * 1024 * 1024,
        MemorySwap: (spec.memoryMb ?? 4096) * 1024 * 1024,
        PidsLimit: spec.pidsLimit ?? 512,
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE", "FOWNER"],
        SecurityOpt: ["no-new-privileges"],
        NetworkMode: spec.network === "none" ? "none" : "bridge",
        ReadonlyRootfs: false,
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=1g" },
        AutoRemove: false,
        LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "1" } },
      },
    });
    await container.start();
    await container.exec({ Cmd: ["sh", "-c", "id -u sandbox >/dev/null 2>&1 || (useradd -u 1000 -m -d /home/sandbox -s /bin/bash sandbox 2>/dev/null || adduser -D -u 1000 -h /home/sandbox sandbox 2>/dev/null || true); mkdir -p /home/sandbox && chown -R 1000:1000 /home/sandbox"], User: "0" }).then((e) => e.start({}).then((s) => new Promise((r) => s.on("end", r).resume())));
    return new DockerSandbox(spec.id, this.docker, container, workdir);
  }

  async get(id: string): Promise<Sandbox | null> {
    const container = this.docker.getContainer(LocalDockerSandboxProvider.containerName(id));
    try {
      const info = await container.inspect();
      if (!info.State.Running) {
        await container.remove({ force: true, v: true }).catch(() => undefined);
        return null;
      }
      return new DockerSandbox(id, this.docker, container, info.Config.WorkingDir || "/workspace");
    } catch {
      return null;
    }
  }

  async reapExpired(): Promise<number> {
    const list = await this.docker.listContainers({ all: true, filters: { label: ["steward.sandbox=1"] } });
    let n = 0;
    for (const c of list) {
      const exp = Number(c.Labels["steward.sandbox.expires"] ?? 0);
      if (exp && exp < Date.now()) {
        await this.docker.getContainer(c.Id).remove({ force: true, v: true }).catch(() => undefined);
        n++;
      }
    }
    return n;
  }
}
