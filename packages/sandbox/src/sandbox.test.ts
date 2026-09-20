/**
 * Live contract test for LocalDockerSandboxProvider. Skips when the Docker socket is not reachable.
 * Uses the small fallback image so it runs in CI without a custom sandbox image build.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Docker from "dockerode";
import { FALLBACK_SANDBOX_IMAGE, LocalDockerSandboxProvider, type Sandbox } from "./index.js";

const IMAGE = process.env.SANDBOX_TEST_IMAGE ?? "alpine:3.20";

let available = false;
try {
  await new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" }).ping();
  available = true;
} catch {
  available = false;
}

const d = available ? it : it.skip;
const provider = new LocalDockerSandboxProvider();
const id = `test-${process.pid}-${Date.now()}`;
let sbx: Sandbox;

beforeAll(async () => {
  if (!available) return;
  sbx = await provider.create({ id, image: IMAGE, cpus: 0.5, memoryMb: 256, network: "none", ttlSeconds: 300 });
}, 240_000);

afterAll(async () => {
  if (available && sbx) await sbx.destroy();
});

describe("LocalDockerSandboxProvider", () => {
  d("runs commands as the unprivileged sandbox user with dropped capabilities", async () => {
    const who = await sbx.exec(["sh", "-c", "id -u; cat /proc/self/status | grep CapEff"]);
    expect(who.exitCode).toBe(0);
    expect(who.stdout.split("\n")[0]).toBe("1000");
    expect(who.stdout).toMatch(/CapEff:\s+0000000000000000/);
  });

  d("writes, lists and reads files inside the workspace", async () => {
    await sbx.writeFiles([
      { path: "/workspace/src/hello.txt", content: "hello sandbox" },
      { path: "/workspace/run.sh", content: "#!/bin/sh\ncat src/hello.txt\n", mode: 0o755 },
    ]);
    const files = await sbx.listFiles("/workspace", { maxDepth: 3 });
    expect(files).toEqual(expect.arrayContaining(["/workspace/src/hello.txt", "/workspace/run.sh"]));
    const out = await sbx.exec(["./run.sh"], { cwd: "/workspace" });
    expect(out.stdout.trim()).toBe("hello sandbox");
    expect((await sbx.readFile("/workspace/src/hello.txt")).toString()).toBe("hello sandbox");
  });

  d("enforces per-command timeouts, output caps and reports non-zero exits", async () => {
    const slow = await sbx.exec(["sh", "-c", "sleep 30"], { timeoutMs: 1500 });
    expect(slow.timedOut).toBe(true);
    expect(slow.exitCode).not.toBe(0);

    const big = await sbx.exec(["sh", "-c", "head -c 200000 /dev/zero | tr '\\0' 'x'"], { maxOutputBytes: 4096 });
    expect(big.stdout.length).toBeLessThan(6000);
    expect(big.stdout).toContain("truncated");

    const fail = await sbx.exec(["sh", "-c", "echo oops >&2; exit 7"]);
    expect(fail.exitCode).toBe(7);
    expect(fail.stderr.trim()).toBe("oops");
  });

  d("has no network when network=none", async () => {
    const net = await sbx.exec(["sh", "-c", "ip -o link | grep -v ' lo:' | wc -l"], { timeoutMs: 5000 });
    expect(net.stdout.trim()).toBe("0");
  });

  d("get() returns the running sandbox and reapExpired removes only expired ones", async () => {
    expect((await provider.get(id))?.id).toBe(id);
    expect(await provider.get("does-not-exist")).toBeNull();

    const expired = await provider.create({ id: `${id}-expired`, image: IMAGE, memoryMb: 128, network: "none", ttlSeconds: -1 });
    expect((await provider.get(expired.id))?.id).toBe(expired.id);
    const reaped = await provider.reapExpired();
    expect(reaped).toBeGreaterThanOrEqual(1);
    expect(await provider.get(expired.id)).toBeNull();
    expect((await provider.get(id))?.id).toBe(id);
  }, 120_000);

  d("falls back to a known-good image when the requested one cannot be pulled", async () => {
    const img = await provider.ensureImage("steward/definitely-missing-image:0.0.0");
    expect(img).toBe(FALLBACK_SANDBOX_IMAGE);
  }, 240_000);
});
