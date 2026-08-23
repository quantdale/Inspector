import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LeaseManager } from "./leases.js";
import { ResourceLedger } from "./ledger.js";
import { FindingClusterer } from "./cluster.js";
import { AdapterRegistry } from "./discovery.js";
import {
  UnattendedCampaign,
  InspectorFacade,
  FakeItemExecutor,
  type WorkItem,
  type WorkItemExecutor,
  type WorkItemResult,
  type UsageEntry,
} from "./index.js";
import type { Finding } from "@inspector/finding";

let dirs: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `inspector-harden-${name}-`));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const m of openManagers) m.close();
  openManagers.length = 0;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function items(suffix = ""): WorkItem[] {
  return [1, 2, 3, 4].map((n) => ({
    id: `item-${n}${suffix}`,
    priority: n,
    mode: "hunt",
    target: "fake",
    seed: n * 11,
    steps: 2,
  }));
}

const USAGE = { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 };

// SQLite keeps the leases.db handle open; managers must be closed before the
// temp dirs are removed (Windows cannot delete an open database file).
const openManagers: LeaseManager[] = [];
function makeLeases(
  dir: string,
  backend: "json" | "sqlite",
  now?: () => number,
  ttl?: number,
): LeaseManager {
  const m = new LeaseManager(dir, now, ttl, { backend });
  openManagers.push(m);
  return m;
}
const BACKENDS = ["json", "sqlite"] as const;

type ExecuteItemImpl = (this: unknown, item: WorkItem, workerId: string, generation?: number) => Promise<boolean>;
type LegacyPatchRef = ExecuteItemImpl | undefined;
void (0 as unknown as LegacyPatchRef);

/** One execution-level injection hook around the real fake executor body. */
type ExecuteHook = (
  item: WorkItem,
  runReal: () => Promise<WorkItemResult>,
) => Promise<WorkItemResult | void>;

/**
 * M12: item execution is delegated to a pluggable WorkItemExecutor, so the
 * historical prototype-level seam is replaced by executor injection with the
 * same hook semantics (throw to fail, runReal to proceed).
 */
function wrappedExecutor(usage = USAGE): {
  executor: WorkItemExecutor;
  addHook(hook: ExecuteHook): void;
  count(): number;
} {
  const inner = new FakeItemExecutor({ usagePerStep: usage });
  let calls = 0;
  const hooks: ExecuteHook[] = [];
  const executor: WorkItemExecutor = {
    id: "test-wrapped",
    capabilities: () => inner.capabilities(),
    async execute(item, ctx) {
      calls += 1;
      const workItem = item as WorkItem;
      const runReal = () => inner.execute(workItem, ctx);
      for (const hook of hooks) {
        const out = await hook(workItem, runReal);
        if (out !== undefined) return out;
      }
      return runReal();
    },
  };
  return { executor, addHook: (h) => hooks.push(h), count: () => calls };
}

function readCampaignJson(stateDir: string): {
  queue: string[];
  executions: Array<{ itemId: string; workerId: string }>;
  findings: unknown[];
  failed?: string[];
} {
  return JSON.parse(readFileSync(join(stateDir, "campaign.json"), "utf8")) as {
    queue: string[];
    executions: Array<{ itemId: string; workerId: string }>;
    findings: unknown[];
    failed?: string[];
  };
}

function finding(id: string): Finding {
  return {
    id,
    runId: "run",
    status: "CONFIRMED",
    title: "crash",
    confidence: 0.9,
    severity: "high",
    revision: null,
    oracleIds: ["zeta", "alpha"],
    reproduction: null,
    artifactRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe.each(BACKENDS)("lease durability via %s backend", (backend) => {
  it("two LeaseManager instances on one stateDir cannot both acquire the same item", () => {
    const dir = fresh(`d1-leases-${backend}`);
    const a = makeLeases(dir, backend);
    const b = makeLeases(dir, backend); // snapshot predates a's persist
    expect(a.acquire("item-x", "w1").ok).toBe(true);
    const second = b.acquire("item-x", "w2");
    if (second.ok) throw new Error("double acquire succeeded for w2");
    expect(second.reason).toBe("held");
  });

  it("reclaim bumps the generation and a stale completion is rejected", () => {
    let t = 1000;
    const now = (): number => t;
    const dir = fresh(`d2-fencing-${backend}`);
    const m = makeLeases(dir, backend, now, 100);
    const first = m.acquire("item", "w1");
    if (!first.ok) throw new Error("initial acquire failed");
    expect(first.lease.generation).toBe(1);

    t += 200; // expire the lease
    const again = m.acquire("item", "w1"); // reclaim after expiry
    if (!again.ok) throw new Error("expired lease not reclaimable");
    expect(again.lease.generation).toBe(2);

    // The generation-1 execution finally finishes and tries to complete.
    expect(m.complete("item", "w1", 1)).toBe(false); // stale: fenced out
    expect(m.isDone("item")).toBe(false);
    expect(m.complete("item", "w1", 2)).toBe(true); // current generation wins
    expect(m.isDone("item")).toBe(true);
  });

  it("renew validates ownership and generation", () => {
    let t = 1000;
    const now = (): number => t;
    const dir = fresh(`d2-renew-${backend}`);
    const m = makeLeases(dir, backend, now, 100);
    const lease = m.acquire("item", "w1");
    if (!lease.ok) throw new Error("acquire failed");
    t += 200; // expire
    const other = makeLeases(dir, backend, now, 100);
    const reclaimed = other.acquire("item", "w2");
    if (!reclaimed.ok) throw new Error("reclaim failed");
    expect(m.renew("item", "w1", 1)).toBe(false); // stale owner + stale generation
    expect(other.renew("item", "w3", reclaimed.lease.generation)).toBe(false); // wrong owner
    expect(other.renew("item", "w2", reclaimed.lease.generation)).toBe(true);
    const inFlight = other.inFlight();
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]!.expiresAtMs).toBeGreaterThan(t + 50);
  });

  it("complete without an explicit generation still requires the current owner", () => {
    const dir = fresh(`d2-compat-${backend}`);
    const m = makeLeases(dir, backend);
    expect(m.acquire("item", "w1")).toMatchObject({ ok: true });
    expect(m.complete("item", "w2")).toBe(false);
    expect(m.complete("item", "w1")).toBe(true);
  });
});

describe("D1: cross-instance state must be serialized through a durable lock", () => {
  it("two ResourceLedger instances cannot both spend the same budget", () => {
    const dir = fresh("d1-ledger");
    const a = new ResourceLedger(dir, { maxActions: 10 });
    const b = new ResourceLedger(dir, { maxActions: 10 });
    expect(a.charge({ workerId: "w", actions: 10 })).toBe(true);
    expect(b.charge({ workerId: "w", actions: 10 })).toBe(false);
    expect(new ResourceLedger(dir, { maxActions: 10 }).totals().actions).toBe(10);
  });

  it("a second campaign instance over one stateDir never re-executes completed items", async () => {
    const stateDir = join(fresh("d1-campaign"), "state");
    const wrapped = wrappedExecutor();
    try {
      const a = new UnattendedCampaign({ stateDir, workerCount: 1, items: items(), usagePerStep: USAGE, executor: wrapped.executor });
      const b = new UnattendedCampaign({ stateDir, workerCount: 1, items: items(), usagePerStep: USAGE, executor: wrapped.executor });
      await a.run();
      const afterA = wrapped.count();
      await b.run();
      expect(wrapped.count()).toBe(afterA); // b executed nothing
      const disk = readCampaignJson(stateDir);
      expect(disk.executions.map((e) => e.itemId).sort()).toEqual([
        "item-1", "item-2", "item-3", "item-4",
      ]);
    } finally {
      /* executor seam needs no restore */
    }
  });
});

describe("D3: corrupt durable state fails loud and is quarantined", () => {
  it("a truncated state file raises StateCorruptionError instead of silently resetting", async () => {
    const dir = fresh("d3-corrupt");
    writeFileSync(join(dir, "leases.json"), "{ truncated...");
    const { StateCorruptionError } = await import("./state-file.js");
    expect(() => new LeaseManager(dir)).toThrow(StateCorruptionError);
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith("leases.json.corrupt-"))).toBe(true);
    expect(files).not.toContain("leases.json"); // moved aside, not reset
  });

  it("save leaves no .tmp residue and load cleans up leftover .tmp files", () => {
    const dir = fresh("d3-tmp");
    const leases = new LeaseManager(dir);
    expect(leases.acquire("a", "w1").ok).toBe(true);
    expect(existsSync(join(dir, "leases.json.tmp"))).toBe(false);
    writeFileSync(join(dir, "ledger.json.tmp"), "junk from crashed save");
    new ResourceLedger(dir); // load must sweep the leftover tmp
    expect(existsSync(join(dir, "ledger.json.tmp"))).toBe(false);
  });
});

describe("D4: stop stays durable but resume unbricks the campaign", () => {
  it("remote stop persists across restart until an operator resumes", async () => {
    const base = fresh("d4-stop-resume");
    const stateDir = join(base, "state");
    const a = new UnattendedCampaign({ stateDir, workerCount: 1, items: items(), usagePerStep: USAGE });
    const facade = new InspectorFacade({
      status: () => ({ running: true, queue: 4, completed: 0, inFlight: 0 }),
      findings: () => [],
      ledger: a.ledgerRef,
      registry: new AdapterRegistry(),
      stop: () => a.stop(),
      resume: () => a.resume(),
    });
    const stopped = await facade.handle({ method: "campaign.stop" });
    expect(stopped.ok).toBe(true);
    expect(a.ledgerRef.isStopped).toBe(true);

    // Restart over the same durable state: still durably stopped, nothing executes.
    const b = new UnattendedCampaign({ stateDir, workerCount: 1, items: items(), usagePerStep: USAGE });
    const halted = await b.run();
    expect(halted.executions).toHaveLength(0);

    // Operator resume clears the durable flag; the campaign completes normally.
    const resumed = await facade.handle({ method: "campaign.resume" });
    expect(resumed.ok).toBe(true);
    expect(b.ledgerRef.isStopped).toBe(false);
    const report = await b.run();
    expect(report.completed.sort()).toEqual(["item-1", "item-2", "item-3", "item-4"]);
  });

  it("facade converts dependency throws into error responses", async () => {
    const base = fresh("d4-facade-errors");
    const stateDir = join(base, "state");
    const campaign = new UnattendedCampaign({ stateDir, workerCount: 1, items: [], usagePerStep: USAGE });
    const facade = new InspectorFacade({
      status: () => {
        throw new Error("status exploded");
      },
      findings: () => {
        throw new Error("findings exploded");
      },
      ledger: campaign.ledgerRef,
      registry: new AdapterRegistry(),
      stop: () => campaign.stop(),
      resume: () => campaign.resume(),
    });
    const status = await facade.handle({ method: "campaign.status" });
    expect(status.ok).toBe(false);
    expect(status.error?.code).toBe("DEPENDENCY_ERROR");
    expect(status.error?.message).toContain("status exploded");
    const findings = await facade.handle({ method: "findings.list" });
    expect(findings.ok).toBe(false);
    expect(findings.error?.code).toBe("DEPENDENCY_ERROR");
  });
});

describe("D5: per-item failure containment and cleanup", () => {
  it("an adapter throw is contained: durable failure record, lease released, run continues", async () => {
    const stateDir = join(fresh("d5-containment"), "state");
    const wrapped = wrappedExecutor();
    wrapped.addHook(async (item, runReal) => {
      if (item.id === "item-1") throw new Error("adapter exploded");
      return runReal();
    });
    const campaign = new UnattendedCampaign({
      stateDir,
      workerCount: 1,
      items: items(),
      usagePerStep: USAGE,
      executor: wrapped.executor,
    });
    const report = await campaign.run(); // pre-fix: rejects, aborting the whole run
    expect(report.failed).toContain("item-1");
    expect(report.completed.sort()).toEqual(["item-2", "item-3", "item-4"]);
    expect(report.failureDetails?.["item-1"]?.class).toBe("execution-failure");
    const disk = readCampaignJson(stateDir);
    expect(disk.failed).toContain("item-1"); // durably recorded
    expect(new LeaseManager(stateDir).inFlight()).toHaveLength(0); // lease released
  });

  it("work done before a crash stays durable: findings persist even when the item fails", async () => {
    const stateDir = join(fresh("d5-findings"), "state");
    const wrapped = wrappedExecutor();
    wrapped.addHook(async (_item, runReal) => {
      await runReal(); // real execution ingests a finding
      throw new Error("crash after ingest"); // simulate controller death right after work
    });
    const campaign = new UnattendedCampaign({
      stateDir,
      workerCount: 1,
      items: items(),
      usagePerStep: USAGE,
      executor: wrapped.executor,
    });
    const report = await campaign.run(); // pre-fix: rejects on the first item
    expect(report.failed).toHaveLength(4);
    const disk = readCampaignJson(stateDir);
    expect(disk.findings).toHaveLength(4); // findings durable despite item failure
    expect(disk.executions).toHaveLength(0); // no false positives recorded
  });

  it("per-item workspaces are cleaned up on both success and failure paths", async () => {
    const base = fresh("d5-temp-cleanup");
    const stateDir = join(base, "state");
    const artifactsDir = join(base, "artifacts");
    const scanTmpLitter = (): string[] =>
      readdirSync(tmpdir()).filter((f) => f.startsWith("inspector-worker-0-leakprobe-a-"));
    const wrapped = wrappedExecutor();
    wrapped.addHook(async (item, runReal) => {
      const result = await runReal();
      if (item.id.endsWith("b")) {
        return { ...result, ok: false, failureClass: "execution-failure", failureDetail: "injected" };
      }
      return result;
    });
    const campaign = new UnattendedCampaign(
      {
        stateDir,
        workerCount: 1,
        items: [
          { id: "leakprobe-a", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1 },
          { id: "leakprobe-ab", priority: 2, mode: "hunt", target: "fake", seed: 2, steps: 1 },
        ],
        usagePerStep: USAGE,
        executor: wrapped.executor,
      },
      artifactsDir,
    );
    try {
      const report = await campaign.run();
      expect(report.completed).toEqual(["leakprobe-a"]);
      expect(scanTmpLitter()).toEqual([]); // no mkdtemp litter outside the artifacts root
      const itemsRoot = join(artifactsDir, "items");
      expect(existsSync(itemsRoot)).toBe(true);
      expect(readdirSync(itemsRoot)).toEqual([]); // per-item workspaces removed on both paths
    } finally {
      campaign.dispose();
    }
  });

  it("dispose removes an auto-created artifacts dir but never a caller-provided one", async () => {
    const provided = fresh("d5-provided-artifacts");
    const autoBase = fresh("d5-auto-artifacts");
    const campaign = new UnattendedCampaign(
      {
        stateDir: join(autoBase, "state"),
        workerCount: 1,
        items: [{ id: "d1x", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1 }],
        usagePerStep: USAGE,
      },
      provided, // caller-provided artifacts dir
    );
    expect(campaign.artifactDir).toBe(provided);
    await campaign.run();
    campaign.dispose();
    expect(existsSync(provided)).toBe(true); // caller-owned: untouched

    const auto = new UnattendedCampaign({
      stateDir: join(autoBase, "state2"),
      workerCount: 1,
      items: [{ id: "d2x", priority: 1, mode: "hunt", target: "fake", seed: 2, steps: 1 }],
      usagePerStep: USAGE,
    });
    const autoDir = auto.artifactDir;
    expect(existsSync(autoDir)).toBe(true);
    auto.dispose();
    expect(existsSync(autoDir)).toBe(false); // auto-created: cleaned up
  });
});

describe("D6: long items renew their lease during execution", () => {
  it("renewal extends expiry past the initial TTL while the item runs", async () => {
    const t0 = 50_000;
    let t = t0;
    const stateDir = join(fresh("d6-renewal"), "state");
    const campaign = new UnattendedCampaign({
      stateDir,
      workerCount: 1,
      items: [{ id: "slow-item", priority: 1, mode: "hunt", target: "fake", seed: 7, steps: 4 }],
      usagePerStep: { modelRequests: 1, tokens: 10, costUsd: 0.001, actions: 1 },
      now: () => t,
      leaseTtlMs: 1000,
    });
    const leases = (campaign as unknown as { leasesRef?: LeaseManager }).leasesRef;
    expect(leases).toBeDefined(); // pre-fix: not exposed, renew has zero callers
    if (!leases) throw new Error("leasesRef missing");
    const renewSpy = vi.spyOn(leases, "renew");

    const ledger = campaign.ledgerRef as unknown as {
      charge: (e: UsageEntry) => boolean;
    };
    const origCharge = ledger.charge.bind(ledger);
    let maxExpirySeen = 0;
    ledger.charge = (e: UsageEntry) => {
      t += 600; // simulated wall-clock progress per step
      for (const l of leases.inFlight()) {
        if (l.itemId === "slow-item") maxExpirySeen = Math.max(maxExpirySeen, l.expiresAtMs);
      }
      return origCharge(e);
    };

    const report = await campaign.run();
    expect(report.completed).toContain("slow-item");
    expect(renewSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(maxExpirySeen).toBeGreaterThan(t0 + 1000); // expiry extended beyond initial TTL
  });
});

describe("D7: input validation and purity hygiene", () => {
  it("ledger rejects negative and non-finite usage amounts", () => {
    const ledger = new ResourceLedger(fresh("d7-ledger"));
    expect(() => ledger.charge({ workerId: "w", actions: -1 })).toThrow(TypeError);
    expect(() => ledger.charge({ workerId: "w", tokens: Number.NaN })).toThrow(TypeError);
    expect(() => ledger.charge({ workerId: "w", costUsd: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(ledger.totals().actions).toBe(0); // nothing recorded
    expect(ledger.charge({ workerId: "w", actions: 3 })).toBe(true); // valid entries still fine
  });

  it("clusterer does not mutate the caller's oracleIds array", () => {
    const f = finding("f1");
    new FindingClusterer().add(f, { errorText: "boom" });
    expect(f.oracleIds).toEqual(["zeta", "alpha"]); // pre-fix: sorted in place
  });

  it("discovery excludes conformance:'fail' adapters unless explicitly included", () => {
    const registry = new AdapterRegistry()
      .register({ id: "web", version: "1.0", protocolVersion: "0.1", conformance: "pass" })
      .register({ id: "broken", version: "1.0", protocolVersion: "0.1", conformance: "fail" });
    expect(registry.discover().map((a) => a.id)).toEqual(["web"]);
    expect(registry.discover({ includeFailed: true }).map((a) => a.id).sort()).toEqual([
      "broken", "web",
    ]);
  });
});
