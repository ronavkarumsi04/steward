/**
 * The browser service's engine.
 *
 * The browser itself is tested where a browser is: `packages/browser` drives a real Chromium against a real page.
 * What is tested here is everything that decides *what the founder can check afterwards* — which sessions exist,
 * what each action wrote down, whether a stop is final, what happens when the process holding a page disappears,
 * and what a stack with no browser at all says. Those are database rules, so they run against a real PostgreSQL,
 * with a provider that keeps the same contract and no process.
 *
 * The one thing the fake does that the real provider does is ask `stillWanted` before it acts, because that is the
 * only way to test the race a Stop actually creates: the decision landing between the service's check and the
 * browser's next action.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import pg from "pg";
import { BrowserAction } from "@steward/browser";
import { browserFrames, createDb, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import { AuthService } from "./auth.js";
import { BrowserService, browserInstruction, startBrowsingRun } from "./browser.js";
import { CompanyService } from "./companies.js";
import { EventService } from "./events.js";
import { AgentService, RunService } from "./work.js";
import { FakeBrowserProvider } from "./test/fake-browser.js";

const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
let available = false;
let db: Db;
let pool: pg.Pool;
const uniq = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  try {
    const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 1500 });
    await probe.query("select 1");
    await probe.end();
    available = true;
  } catch {
    available = false;
    return;
  }
  ({ db, pool } = createDb(url));
});
afterAll(async () => {
  await pool?.end();
});

/** A founder, a company, and a clock a test can move. */
async function setup() {
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `browser-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Browser ${uniq()}`, autonomyLevel: 2 });
  const other = await new CompanyService(db).create(orgScope, { name: `Other ${uniq()}`, autonomyLevel: 2 });
  const clock = { at: new Date("2026-09-20T12:00:00.000Z") };
  const fake = new FakeBrowserProvider();
  const service = new BrowserService(db, fake, () => clock.at);
  return {
    scope: { ...orgScope, companyId: company.id } as TenantScope,
    otherScope: { ...orgScope, companyId: other.id } as TenantScope,
    company,
    clock,
    fake,
    service,
    runId: `run-${uniq()}`,
  };
}

const click = (selector = "#pricing-link") => BrowserAction.parse({ kind: "click", selector });

/** A company with the specialist agents a browsing run can be handed to. */
async function browsable() {
  const context = await setup();
  const agents = await new AgentService(db).list(context.scope);
  return { ...context, agentId: agents[0]!.id };
}

/** Everything that touches the database is skipped, rather than failed, when there is no PostgreSQL to touch. */
const d = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!available) return;
    await fn();
  });

describe("what this stack can do", () => {
  d("says it has no browser instead of offering a click, and still reads the history", async () => {
    const { scope } = await setup();
    const service = new BrowserService(db, null);

    expect(await service.status()).toMatchObject({ provider: "none", available: false });
    expect((await service.status()).reason).toMatch(/no browser provider configured/);
    await expect(service.open(scope, { url: "https://example.com" })).rejects.toMatchObject({ code: "no_provider" });
    // Refusing to open is not the same as refusing to remember: the list is how a founder reviews what happened.
    expect(await service.list(scope)).toEqual([]);
  });

  d("reports a provider that is installed but unusable, in the provider's own words", async () => {
    const { scope, fake, service } = await setup();
    fake.available = false;
    fake.reason = "Chromium is not installed on this machine.";

    expect(await service.status()).toEqual({ provider: "fake", available: false, reason: "Chromium is not installed on this machine." });
    await expect(service.open(scope, { url: "https://example.com" })).rejects.toMatchObject({ code: "no_provider", message: "Chromium is not installed on this machine." });
  });
});

describe("opening a page", () => {
  d("writes down where it went, with a frame a person can look at", async () => {
    const { scope, fake, service } = await setup();
    const runId = `run-${uniq()}`;
    const result = await service.open(scope, { url: "https://example.com/pricing", runId, purpose: "check the pricing page" });

    expect(result.session).toMatchObject({ status: "live", provider: "fake", url: "https://example.com/pricing", startUrl: "https://example.com/pricing", stepCount: 1, frameCount: 1, runId });
    expect(result.snapshot.title).toBe("A fixture page");
    expect(result.frame?.seq).toBe(1);
    expect(result.frame?.action).toBe("Open https://example.com/pricing");
    expect(fake.opened).toHaveLength(1);

    // The bytes really are the browser's bytes, served back as an image.
    const bytes = await service.frameBytes(scope, result.session.id);
    expect(bytes?.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes?.frame.digest).toBe(result.frame?.digest);
    expect((await service.frames(scope, result.session.id)).map((frame) => frame.seq)).toEqual([1]);
  });

  d("refuses an address this deployment will not open, and opens nothing", async () => {
    const { scope, fake, service } = await setup();
    fake.refuseTarget = "169.254.169.254";

    await expect(service.open(scope, { url: "http://169.254.169.254/latest/meta-data/" })).rejects.toMatchObject({ code: "refused" });
    expect(await service.list(scope)).toEqual([]);
    expect(fake.opened).toEqual([]);
    expect(fake.held()).toEqual([]);
  });

  d("keeps a session whose browser never started, with the reason", async () => {
    const { scope, fake, service } = await setup();
    fake.failOpen = "browserType.launch: Executable doesn't exist at /ms-playwright/chromium";

    await expect(service.open(scope, { url: "https://example.com" })).rejects.toMatchObject({ code: "provider" });
    const sessions = await service.list(scope);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ status: "failed" });
    expect(sessions[0]!.error).toMatch(/Executable doesn't exist/);
  });

  d("will not put a second live browser behind one run's name", async () => {
    const { scope, service, runId } = await setup();
    const first = await service.open(scope, { url: "https://example.com", runId });

    await expect(service.open(scope, { url: "https://example.com/other", runId })).rejects.toMatchObject({ code: "refused" });
    expect(await service.list(scope, { runId })).toHaveLength(1);
    expect((await service.get(scope, first.session.id))?.url).toBe("https://example.com");
  });
});

describe("acting on a page", () => {
  const opened = async () => {
    const context = await setup();
    const result = await context.service.open(context.scope, { url: "https://example.com", runId: context.runId });
    return { ...context, sessionId: result.session.id, handle: context.fake.handle(result.session.id)! };
  };

  d("records the step, the frame and where the page is now", async () => {
    const { scope, service, sessionId, fake } = await opened();
    fake.handle(sessionId)!.title = "Pricing — Example";
    fake.handle(sessionId)!.body = "second";

    const result = await service.act(scope, sessionId, click());
    expect(result.session).toMatchObject({ stepCount: 2, frameCount: 2, lastAction: "Click #pricing-link", title: "Pricing — Example" });
    expect(result.frame?.action).toBe("Click #pricing-link");
    expect(await service.frames(scope, sessionId)).toHaveLength(2);
  });

  d("says out loud when an action changed nothing on the page", async () => {
    const { scope, service, sessionId } = await opened();
    const result = await service.act(scope, sessionId, BrowserAction.parse({ kind: "wait", ms: 500 }));

    expect(result.frame).toBeNull();
    expect(result.session).toMatchObject({ stepCount: 2, frameCount: 1 });
    expect(result.session.lastNote).toMatch(/Did wait/);
    expect(await service.frames(scope, sessionId)).toHaveLength(1);
  });

  d("treats a bad selector as the model's mistake, not a dead session", async () => {
    const { scope, service, sessionId, fake } = await opened();
    fake.failAct = "locator.click: Timeout 20000ms exceeded waiting for selector \"#nope\"";

    await expect(service.act(scope, sessionId, click("#nope"))).rejects.toMatchObject({ code: "refused" });
    expect((await service.get(scope, sessionId))?.status).toBe("live");
    // Nothing was written down as a step, because nothing happened.
    expect((await service.get(scope, sessionId))?.stepCount).toBe(1);
  });

  d("treats a page that went away as a session that ended", async () => {
    const { scope, service, sessionId, handle, fake } = await opened();
    handle.aliveFlag = false;

    await expect(service.act(scope, sessionId, click())).rejects.toMatchObject({ code: "provider" });
    expect((await service.get(scope, sessionId))?.status).toBe("failed");
    expect(fake.closedIds).toContain(sessionId);
  });

  d("lets the founder's stop win the race against an action already in flight", async () => {
    const { scope, service, sessionId, fake, handle } = await opened();
    // The founder hits Stop after the service decided the action was allowed but before the browser acts.
    fake.beforeAct = async () => {
      await service.stop(scope, sessionId, "That is enough.");
    };

    await expect(service.act(scope, sessionId, click())).rejects.toMatchObject({ code: "stopped" });
    expect(handle.actions).toEqual([]);
    expect((await service.get(scope, sessionId))?.stepCount).toBe(1);
  });

  d("refuses to act on a session the founder already stopped", async () => {
    const { scope, service, sessionId, handle } = await opened();
    await service.stop(scope, sessionId, "Wrong page.");

    await expect(service.act(scope, sessionId, click())).rejects.toMatchObject({ code: "stopped" });
    expect(handle.actions).toEqual([]);
  });

  d("reads a page without pretending it was a step", async () => {
    const { scope, service, sessionId } = await opened();
    const result = await service.read(scope, sessionId);

    expect(result.session.stepCount).toBe(1);
    expect(result.frame).toBeNull();
    expect(result.snapshot.frame).toBeNull();
  });

  d("does not let another company see or act on it", async () => {
    const { scope, otherScope, service, sessionId } = await opened();

    expect(await service.get(otherScope, sessionId)).toBeNull();
    expect(await service.frames(otherScope, sessionId)).toEqual([]);
    expect(await service.frameBytes(otherScope, sessionId)).toBeNull();
    await expect(service.act(otherScope, sessionId, click())).rejects.toMatchObject({ code: "not_found" });
    await expect(service.stop(otherScope, sessionId)).rejects.toMatchObject({ code: "not_found" });
    expect((await service.get(scope, sessionId))?.status).toBe("live");
  });
});

describe("the run's own session", () => {
  d("hands a run the page it is already on rather than opening a second one", async () => {
    const { scope, service, runId } = await setup();
    const first = await service.ensure(scope, { url: "https://example.com", runId });
    const again = await service.ensure(scope, { url: "https://example.com/ignored", runId });

    expect(first.restored).toBe(false);
    expect(again.restored).toBe(false);
    expect(again.session.id).toBe(first.session.id);
    expect(again.session.url).toBe("https://example.com");
    expect(await service.list(scope, { runId })).toHaveLength(1);
  });

  d("reopens the page and says so when the process holding it is gone", async () => {
    const { scope, service, fake, runId } = await setup();
    const first = await service.ensure(scope, { url: "https://example.com", runId });
    fake.forget(first.session.id);

    const again = await service.ensure(scope, { url: "https://example.com", runId });
    expect(again.restored).toBe(true);
    expect(again.session.id).toBe(first.session.id);
    expect(again.session.url).toBe("https://example.com");
    expect(again.snapshot.notes.join(" ")).toMatch(/Reopened and loaded https:\/\/example\.com/);
    expect(again.session.stepCount).toBe(2);
  });

  d("does not resurrect a session the founder stopped", async () => {
    const { scope, service, runId } = await setup();
    const first = await service.ensure(scope, { url: "https://example.com", runId });
    await service.stop(scope, first.session.id, "Stop looking at that.");

    await expect(service.ensure(scope, { url: "https://example.com", runId })).rejects.toMatchObject({ code: "stopped" });
    expect(await service.list(scope, { runId })).toHaveLength(1);
    expect((await service.get(scope, first.session.id))?.status).toBe("stopped");
  });
});

describe("stopping and closing", () => {
  d("stops for good, closes the page, and keeps who decided", async () => {
    const { scope, service, fake, runId } = await setup();
    const result = await service.open(scope, { url: "https://example.com", runId });
    const sessionId = result.session.id;
    const handle = fake.handle(sessionId)!;

    const stopped = await service.stop(scope, sessionId, "The founder is done watching.");
    expect(stopped).toMatchObject({ status: "stopped", stopReason: "The founder is done watching." });
    expect(stopped.stoppedAt).not.toBeNull();
    expect(fake.closedIds).toContain(sessionId);
    expect(handle.closed).toBe(true);

    // A second stop changes nothing, including when it happened.
    const again = await service.stop(scope, sessionId, "Again.");
    expect(again.stoppedAt).toBe(stopped.stoppedAt);
    expect(again.stopReason).toBe("The founder is done watching.");
    expect((await service.frames(scope, sessionId)).length).toBe(1);
  });

  d("lets the agent close a page it is finished with", async () => {
    const { scope, service, fake, runId } = await setup();
    const result = await service.open(scope, { url: "https://example.com", runId });

    const closed = await service.close(scope, result.session.id, "Read everything it needed.");
    expect(closed).toMatchObject({ status: "closed", lastNote: "Read everything it needed." });
    expect(closed.stoppedAt).toBeNull();
    expect(fake.closedIds).toContain(result.session.id);
    await expect(service.act(scope, result.session.id, click())).rejects.toMatchObject({ code: "refused", message: expect.stringMatching(/closed/i) });
  });
});

describe("sweeping up after sessions nobody is driving", () => {
  d("closes a session that has gone quiet, and leaves the one that just acted", async () => {
    const { scope, service, clock } = await setup();
    const quiet = await service.open(scope, { url: "https://example.com", runId: `run-quiet-${uniq()}` });
    clock.at = new Date(clock.at.getTime() + 20 * 60_000);
    const recent = await service.open(scope, { url: "https://example.com/live", runId: `run-recent-${uniq()}` });

    const result = await service.sweepStale();
    // Sessions from the tests above are quiet too, so this is about the two it was given, not the total.
    expect(result.closed).toBeGreaterThanOrEqual(1);
    expect((await service.get(scope, quiet.session.id))?.status).toBe("closed");
    expect((await service.get(scope, quiet.session.id))?.lastNote).toMatch(/nothing happened for 15 minutes/);
    expect((await service.get(scope, recent.session.id))?.status).toBe("live");
  });

  d("closes a page this process holds once its session is no longer live, and leaves live ones open", async () => {
    const { scope, runId } = await setup();
    // Two processes, as in a deployment: one owns the Chromium, the other is the API the founder is talking to.
    const workerFake = new FakeBrowserProvider();
    const worker = new BrowserService(db, workerFake);
    const api = new BrowserService(db, new FakeBrowserProvider());

    const stopped = await worker.open(scope, { url: "https://example.com", runId });
    const live = await worker.open(scope, { url: "https://example.com/live", runId: `${runId}-b` });
    await api.stop(scope, stopped.session.id, "Enough.");
    // The row changed in the other process, and the page here does not know yet.
    expect(workerFake.handle(stopped.session.id)).toBeDefined();

    expect((await worker.closeOrphaned()).closed).toEqual([stopped.session.id]);
    expect(workerFake.closedIds).toContain(stopped.session.id);
    expect(workerFake.handle(stopped.session.id)).toBeUndefined();
    // A page whose session is still live is left alone: housekeeping must not close what someone is watching.
    expect(workerFake.held()).toEqual([live.session.id]);
    expect((await worker.closeOrphaned()).closed).toEqual([]);
    // And a stack with no browser at all has nothing to close, rather than failing.
    expect(await new BrowserService(db, null).closeOrphaned()).toEqual({ closed: [] });
  });

  d("drops old frames and keeps the sessions they came from", async () => {
    const { scope, service, clock } = await setup();
    const result = await service.open(scope, { url: "https://example.com", runId: `run-frames-${uniq()}` });
    const [old] = await db
      .insert(browserFrames)
      .values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        sessionId: result.session.id,
        seq: 99,
        action: "An older step",
        url: "https://example.com",
        width: 1280,
        height: 800,
        bytes: 4,
        digest: "old",
        data: Buffer.from("old").toString("base64"),
        createdAt: new Date(clock.at.getTime() - 8 * 86_400_000),
      })
      .returning();

    const swept = await service.sweepStale();
    expect(swept.framesDeleted).toBe(1);
    expect((await service.frames(scope, result.session.id)).map((frame) => frame.seq)).toEqual([1]);
    expect(await service.get(scope, result.session.id)).not.toBeNull();
    expect(await db.select().from(browserFrames).where(eq(browserFrames.id, old!.id))).toEqual([]);
  });

  d("keeps the newest frames of a session and lets the oldest fall out", async () => {
    const { scope, service, fake, runId } = await setup();
    const result = await service.open(scope, { url: "https://example.com", runId });
    const rows = Array.from({ length: 39 }, (_, index) => ({
      organizationId: scope.organizationId,
      companyId: scope.companyId!,
      sessionId: result.session.id,
      seq: index + 2,
      action: `Step ${index + 2}`,
      url: "https://example.com",
      width: 1280,
      height: 800,
      bytes: 4,
      digest: `digest-${index + 2}`,
      data: Buffer.from("jpeg").toString("base64"),
    }));
    await db.insert(browserFrames).values(rows);

    fake.handle(result.session.id)!.body = "a page that changed";
    await service.act(scope, result.session.id, click());

    const frames = await service.frames(scope, result.session.id);
    expect(frames).toHaveLength(40);
    expect(frames[0]!.seq).toBe(2);
    expect(frames.at(-1)!.seq).toBe(41);
  });
});

describe("turning “watch this page for me” into a run", () => {
  d("records the run first, then starts it, and hands it the instruction the founder would read", async () => {
    const { scope, service, agentId } = await browsable();
    const started: string[] = [];
    const result = await startBrowsingRun({
      db,
      runs: new RunService(db),
      scope,
      url: "https://example.com/pricing",
      objective: "check the annual price",
      agentId,
      operator: "Ada",
      launcher: {
        start: async ({ runId }) => {
          started.push(runId);
          return { workflowId: `wf-${runId}`, workflowRunId: "temporal-1" };
        },
      },
    });

    expect(result.status).toBe("started");
    expect(result.reason).toBeNull();
    expect(started).toEqual([result.runId]);
    expect(result.instruction).toContain("https://example.com/pricing");
    expect(result.instruction).toContain("check the annual price");
    expect(result.instruction).toContain("Ada asked for this");
    // The instruction the founder reads and the one the runtime holds are the same bytes.
    const run = await new RunService(db).get(scope, result.runId);
    expect((run?.trigger as { instruction: string }).instruction).toBe(result.instruction);
    expect(run?.agentId).toBe(agentId);
    // Nothing has opened yet: the run opening the page is the point, not the request.
    expect(await service.list(scope)).toEqual([]);
  });

  d("leaves a queued run rather than a lost intention when there is no workflow engine", async () => {
    const { scope, agentId } = await browsable();
    const result = await startBrowsingRun({ db, runs: new RunService(db), scope, url: "https://example.com", objective: "read it", agentId, launcher: null });
    expect(result.status).toBe("queued");
    expect(result.reason).toMatch(/No workflow engine/);
    expect((await new RunService(db).get(scope, result.runId))?.id).toBe(result.runId);
  });

  d("says the run exists but its workflow did not start, rather than pretending it is running", async () => {
    const { scope, agentId } = await browsable();
    const result = await startBrowsingRun({
      db,
      runs: new RunService(db),
      scope,
      url: "https://example.com",
      objective: "read it",
      agentId,
      launcher: {
        start: async () => {
          throw new Error("temporal unavailable");
        },
      },
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/temporal unavailable/);
    expect((await new RunService(db).get(scope, result.runId))?.id).toBe(result.runId);
  });
});

describe("the events a live view subscribes to", () => {
  d("filters by a set of types, not by one and not by a malformed tuple", async () => {
    const { scope, service, runId } = await setup();
    const events = new EventService(db);
    const before = await events.latestSeq();
    await service.open(scope, { url: "https://example.com", runId });
    await service.act(scope, runId ? (await service.liveForRun(scope, runId))!.id : "", BrowserAction.parse({ kind: "scroll", to: "down" }));

    // The page's own list: five types at once. A filter built as a tuple rather than a set works with one type and
    // fails with two, which is the shape of a live stream and exactly what this asserts.
    const five = await events.since(scope, before, 200, ["browser.opened", "browser.step", "browser.stopped", "browser.closed", "browser.failed"]);
    // Opening a session is a step in its own right, so two events of that kind follow the one that opened it.
    expect(five.map((event) => event.type)).toEqual(["browser.opened", "browser.step", "browser.step"]);
    // Two types, and the newest-first read of the same set.
    expect((await events.since(scope, before, 200, ["browser.opened", "browser.step"])).length).toBe(3);
    expect(new Set((await events.recent(scope, 200, undefined, ["browser.opened", "browser.step"])).map((event) => event.type))).toEqual(new Set(["browser.opened", "browser.step"]));
    // A single type still works, and an empty list means no filter rather than no events.
    expect((await events.since(scope, before, 200, ["browser.step"])).length).toBe(2);
    expect((await events.since(scope, before, 200, [])).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the instruction a browsing run is started with", () => {
  it("names the page, the job, and the two rules that make a founder willing to watch", () => {
    const instruction = browserInstruction({ url: "https://example.com/pricing", objective: "check whether the annual price is on the page", operator: "Ada" });

    expect(instruction).toContain("https://example.com/pricing");
    expect(instruction).toContain("check whether the annual price is on the page");
    expect(instruction).toContain("Ada asked for this and is watching the session");
    expect(instruction).toContain("a stopped session refuses every further action");
    expect(instruction).toMatch(/Never type a credential/);
    expect(instruction).toMatch(/untrusted data/);
    expect(instruction).toMatch(/browser\.finish/);
  });

  it("falls back to reading the page when nobody said what to do", () => {
    expect(browserInstruction({ url: "https://example.com", objective: "  " })).toContain("read the page and report what it says");
  });
});
