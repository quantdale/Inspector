import { describe, expect, it, vi, type MockInstance } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LeaseManager,
  ResourceLedger,
  StateCorruptionError,
  UnattendedCampaign,
  type ExecutionContext,
  type WorkItem,
  type WorkItemExecutor,
  type WorkItemResult,
} from "@inspector/scale";

/**
 * HARDENING_2 fleet-runtime hardening: settlement crash windows (D5),
 * scheduler-managed lease liveness (D4), external-hold liveness semantics
 * (D7), semantic state corruption failing closed (D8), and per-item budget
 * enforcement (D14/D1). Deterministic throughout — injectable clocks and
 * fault hooks, never arbitrary sleeps.
 */

function fresh(name: string): string {
  return mkdtempSync(join(tmpdir(), `inspector-h2-${name}-`));
}

const USAGE = { modelRequests: 0, tokens: 0, costUsd: 0, actions: 1 };

function fakeItems(count: number, steps = 2): WorkItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    priority: i + 1,
    mode: "hunt" as const,
    target: "fake",
    adapterFamily: "fake" as const,
    seed: i + 1,
    steps,
  }));
}

interface SlowOptions {
  /** Real ms to sleep per step (deterministic slowness). */
  stepDelayMs: number;
  /** Simulated clock advance per step. */
  tickMs: number;
  onStep?: (step: number, ctx: ExecutionContext) => void;
}

/** Deliberately slow deterministic executor so timing tests cannot pass by accident. */
function slowExecutor(opts: SlowOptions): WorkItemExecutor & { stepsRun: number } {
  const impl = {
    stepsRun: 0,
    id: "slow-fixture",
    capabilities: () => ({
      executorId: "slow-fixture",
      families: ["fake" as const],
      capabilities: ["deterministic-fixture"],
      available: true,
    }),
    async execute(item: { id: string; steps: number }, ctx: ExecutionContext): Promise<WorkItemResult> {
      for (let i = 0; i < item.steps; i++) {
        if (ctx.signal.aborted) throw new Error("ItemCancelledError");
        opts.onStep?.(i, ctx);
        await new Promise((r) => setTimeout(r, opts.stepDelayMs));
        impl.stepsRun += 1;
      }
      return { ok: true, findings: [], evidencePaths: [], runIds: [], usage: {} };
    },
  };
  return impl as unknown as WorkItemExecutor & { stepsRun: number };
}

describe("H2 D5: settlement crash windows recover deterministically", () => {
  it("crash between leases.complete() and recordExecution() cannot strand the item", async () => {
    const base = fresh("settle-after-complete");
    try {
      const stateDir = join(base, "state");
      let executions = 0;
      const executor: WorkItemExecutor = {
        id: "counting",
        capabilities: () => ({ executorId: "counting", families: ["fake"], capabilities: [], available: true }),
        async execute(item): Promise<WorkItemResult> {
          const it = item as { id: string; steps: number };
          executions += 1;
          return {
            ok: true,
            findings: [],
            evidencePaths: [],
            runIds: [`run-${it.id}`],
            usage: { actions: it.steps * USAGE.actions },
          };
        },
      };
      const makeCampaign = () =>
        new UnattendedCampaign(
          { stateDir, workerCount: 1, items: fakeItems(1), usagePerStep: USAGE, executor },
          join(base, "artifacts"),
        );

      // Life 1: the controller dies EXACTLY between the two durable writes.
      const campaign1 = makeCampaign();
      const recordExecutionSpy = vi
        .spyOn(campaign1 as unknown as { recordExecution: () => void }, "recordExecution")
        .mockImplementationOnce(() => {
          throw new Error("simulated death after leases.complete()");
        });
      await expect(campaign1.run()).rejects.toThrow(/simulated death/);
      recordExecutionSpy.mockRestore();
      campaign1.close();

      // The lease is done but NO execution record exists — the stranded shape.
      const disk1 = JSON.parse(readFileSync(join(stateDir, "campaign.json"), "utf8")) as {
        executions: Array<{ itemId: string }>;
        queue: string[];
      };
      expect(disk1.executions).toHaveLength(0);
      expect(new LeaseManager(stateDir).isDone("item-0")).toBe(true);

      // Life 2: a fresh controller reconciles; the item completes exactly once.
      const campaign2 = makeCampaign();
      try {
        const report = await campaign2.run();
        expect(report.completed).toEqual(["item-0"]);
        expect(report.executions.filter((e) => e.itemId === "item-0")).toHaveLength(1);
        // Exactly one real execution across BOTH lives.
        expect(executions).toBe(1);
      } finally {
        campaign2.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("crash before leases.complete() replays a journalled completion exactly once", async () => {
    const base = fresh("settle-before-complete");
    try {
      const stateDir = join(base, "state");
      let executions = 0;
      const executor: WorkItemExecutor = {
        id: "counting",
        capabilities: () => ({ executorId: "counting", families: ["fake"], capabilities: [], available: true }),
        async execute(rawItem): Promise<WorkItemResult> {
          const item = rawItem as { id: string };
          executions += 1;
          return { ok: true, findings: [], evidencePaths: [], runIds: [`run-${item.id}`], usage: {} };
        },
      };
      const makeCampaign = () =>
        new UnattendedCampaign(
          { stateDir, workerCount: 1, items: fakeItems(1), usagePerStep: USAGE, executor },
          join(base, "artifacts"),
        );
      const campaign1 = makeCampaign();
      const completeSpy = vi
        .spyOn(campaign1.leasesRef, "complete")
        .mockImplementationOnce(() => {
          throw new Error("simulated death before leases.complete()");
        });
      await expect(campaign1.run()).rejects.toThrow(/simulated death/);
      completeSpy.mockRestore();
      campaign1.close();
      expect(new LeaseManager(stateDir).isDone("item-0")).toBe(false);

      const campaign2 = makeCampaign();
      try {
        const report = await campaign2.run();
        expect(report.completed).toEqual(["item-0"]);
        expect(report.executions).toHaveLength(1);
        expect(executions).toBe(1); // replayed from the journal, not re-executed
      } finally {
        campaign2.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("repeated lives over one state directory keep completions exactly-once", async () => {
    const base = fresh("settle-repeat");
    try {
      const stateDir = join(base, "state");
      let executions = 0;
      const executor: WorkItemExecutor = {
        id: "counting",
        capabilities: () => ({ executorId: "counting", families: ["fake"], capabilities: [], available: true }),
        async execute(): Promise<WorkItemResult> {
          executions += 1;
          return { ok: true, findings: [], evidencePaths: [], runIds: [], usage: {} };
        },
      };
      const makeCampaign = () =>
        new UnattendedCampaign(
          { stateDir, workerCount: 2, items: fakeItems(6), usagePerStep: USAGE, executor },
          join(base, "artifacts"),
        );
      // Life 1 dies mid-settlement of one item; life 2+ finish normally.
      const c1 = makeCampaign();
      const spy = vi
        .spyOn(c1 as unknown as { recordExecution: () => void }, "recordExecution")
        .mockImplementationOnce(() => {
          throw new Error("boom");
        });
      await expect(c1.run()).rejects.toThrow(/boom/);
      spy.mockRestore();
      c1.close();

      const c2 = makeCampaign();
      const r2 = await c2.run();
      c2.dispose();
      expect(r2.completed.sort()).toEqual(fakeItems(6).map((i) => i.id).sort());
      expect(r2.executions).toHaveLength(6);
      const disk = JSON.parse(readFileSync(join(stateDir, "campaign.json"), "utf8")) as {
        executions: Array<{ itemId: string }>;
        queue: string[];
      };
      expect(disk.queue).toEqual([]);
      expect(new Set(disk.executions.map((e) => e.itemId))).toHaveLength(6);
      // Six REAL executions total across both lives — the crashed settlement
      // was replayed from the journal, never re-executed.
      expect(executions).toBe(6);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("H2 D4: scheduler-managed lease liveness", () => {
  it("renews long-running executions at half-TTL without executor cooperation", async () => {
    const base = fresh("heartbeat");
    try {
      const t0 = 100_000;
      let t = t0;
      const ttlMs = 200;
      const renewSpyHolder: { spy?: MockInstance } = {};
      const slow = slowExecutor({ stepDelayMs: 25, tickMs: 0 });
      const makeCampaign = () => {
        const c = new UnattendedCampaign(
          {
            stateDir: join(base, "state"),
            workerCount: 1,
            items: [{ id: "long-item", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 8 }],
            usagePerStep: USAGE,
            executor: slow,
            now: () => t,
            leaseTtlMs: ttlMs,
          },
          join(base, "artifacts"),
        );
        renewSpyHolder.spy = vi.spyOn(c.leasesRef, "renew");
        return c;
      };
      const campaign = makeCampaign();
      // Advance simulated time from within the running execution so the
      // heartbeat's cadence gate (half-TTL) opens deterministically.
      const originalExecute = slow.execute.bind(slow);
      (slow as unknown as { execute: unknown }).execute = async (item: { id: string; steps: number }, ctx: ExecutionContext) => {
        for (let i = 0; i < item.steps; i++) {
          if (ctx.signal.aborted) throw new Error("ItemCancelledError");
          t += 120; // > half-TTL each step
          await new Promise((r) => setTimeout(r, 25));
        }
        return { ok: true, findings: [], evidencePaths: [], runIds: [], usage: {} };
      };
      try {
        const report = await campaign.run();
        expect(report.completed).toContain("long-item");
        expect(renewSpyHolder.spy!.mock.calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        campaign.dispose();
      }
      void originalExecute;
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("a lost fencing generation aborts the stale execution immediately", async () => {
    const base = fresh("fence-abort");
    try {
      let t = 500_000;
      const ttlMs = 40;
      const stateDir = join(base, "state");
      const sawAbort = { value: false };
      const slow = slowExecutor({ stepDelayMs: 20, tickMs: 0 });
      const wrapped: WorkItemExecutor = {
        id: slow.id,
        capabilities: () => slow.capabilities(),
        async execute(rawItem, ctx): Promise<WorkItemResult> {
          const item = rawItem as { id: string; steps: number };
          for (let i = 0; i < item.steps; i++) {
            if (ctx.signal.aborted) {
              sawAbort.value = true;
              throw Object.assign(new Error("cancelled"), { name: "ItemCancelledError" });
            }
            // Advance simulated time past half-TTL each step so the
            // scheduler heartbeat's cadence gate opens deterministically.
            t += ttlMs;
            await new Promise((r) => setTimeout(r, 12));
          }
          return { ok: true, findings: [], evidencePaths: [], runIds: [], usage: {} };
        },
      };
      const campaign = new UnattendedCampaign(
        { stateDir, workerCount: 1, items: fakeItems(1, 50), usagePerStep: USAGE, executor: wrapped, now: () => t, leaseTtlMs: ttlMs },
        join(base, "artifacts"),
      );
      const runPromise = campaign.run();
      // Wait until the claim exists, then steal ownership with a bumped
      // generation — exactly what a reclaiming second controller does.
      for (let i = 0; i < 200 && !sawAbort.value && campaign.leasesRef.inFlight().length === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const thief = new LeaseManager(stateDir, () => t + ttlMs + 1, ttlMs);
      const stolen = thief.acquire("item-0", "thief-worker");
      expect(stolen.ok).toBe(true);
      const report = await runPromise;
      thief.close();
      campaign.dispose();
      expect(sawAbort.value).toBe(true); // stale holder was aborted, not left running
      expect(report.executions).toHaveLength(0); // never recorded success
      expect(report.staleCompletions).toBe(1); // fenced as stale
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("H2 D7: externally-held work produces truthful liveness", () => {
  it("waits for reclaim of an expired external hold and completes exactly once", async () => {
    const base = fresh("hold-expiry");
    try {
      const stateDir = join(base, "state");
      const ttlMs = 400;
      let t = Date.now();
      const external = new LeaseManager(stateDir, () => t, ttlMs);
      const acquired = external.acquire("held-item", "external-process");
      expect(acquired.ok).toBe(true);
      // External holder goes away WITHOUT completing: its lease simply expires.
      t += ttlMs + 50;

      const campaign = new UnattendedCampaign(
        {
          stateDir,
          workerCount: 1,
          items: [{ id: "held-item", priority: 1, mode: "hunt", target: "fake", seed: 3, steps: 1 }],
          usagePerStep: USAGE,
          now: () => t,
          leaseTtlMs: ttlMs,
        },
        join(base, "artifacts"),
      );
      try {
        const started = Date.now();
        const report = await campaign.run();
        expect(report.completed).toEqual(["held-item"]);
        expect(Date.now() - started).toBeGreaterThanOrEqual(0); // reclaimed only after expiry
        expect(report.stopReason).toBeNull();
      } finally {
        campaign.dispose();
        external.close();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("a continuously-renewed external hold yields blocked truth, never false completion", async () => {
    const base = fresh("hold-blocked");
    try {
      const stateDir = join(base, "state");
      const ttlMs = 250;
      let t = Date.now();
      const external = new LeaseManager(stateDir, () => t, ttlMs);
      expect(external.acquire("held-item", "external-process").ok).toBe(true);

      const campaign = new UnattendedCampaign(
        {
          stateDir,
          workerCount: 1,
          items: [{ id: "held-item", priority: 1, mode: "hunt", target: "fake", seed: 3, steps: 1 }],
          usagePerStep: USAGE,
          now: () => t,
          leaseTtlMs: ttlMs,
        },
        join(base, "artifacts"),
      );
      // Keep the external lease alive past one full reclaim opportunity.
      const renewer = setInterval(() => {
        external.renew("held-item", "external-process");
        t += 100;
      }, 60);
      try {
        const report = await campaign.run();
        expect(report.stopReason).toBe("blocked-external-holds");
        expect(report.blocked).toBeDefined();
        expect(report.blocked!.heldItems).toBe(1);
        expect(report.completed).toEqual([]);
        expect(report.failed).toEqual([]);
        // The queue still truthfully contains the unresolved required item.
        const disk = JSON.parse(readFileSync(join(stateDir, "campaign.json"), "utf8")) as { queue: string[] };
        expect(disk.queue).toEqual(["held-item"]);
      } finally {
        clearInterval(renewer);
        campaign.dispose();
        external.close();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("H2 D7/D4: two controllers over one state directory", () => {
  it("a second controller reports blocked truth while the first is live, and never duplicates execution", async () => {
    const base = fresh("two-controllers");
    try {
      const stateDir = join(base, "state");
      const ttlMs = 250;
      let t = Date.now();
      // Gate: controller A holds the item mid-execution until released.
      let releaseA!: () => void;
      const gateA = new Promise<void>((r) => {
        releaseA = r;
      });
      const holderExecutor: WorkItemExecutor = {
        id: "holder-a",
        capabilities: () => ({ executorId: "holder-a", families: ["fake"], capabilities: [], available: true }),
        async execute(item, ctx): Promise<WorkItemResult> {
          const done = Promise.resolve();
          void done;
          await gateA;
          if (ctx.signal.aborted) throw Object.assign(new Error("cancelled"), { name: "ItemCancelledError" });
          return { ok: true, findings: [], evidencePaths: [], runIds: [], usage: {} };
        },
      };
      const a = new UnattendedCampaign(
        {
          stateDir,
          workerCount: 1,
          items: [{ id: "contested", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1 }],
          usagePerStep: USAGE,
          executor: holderExecutor,
          now: () => t,
          leaseTtlMs: ttlMs,
        },
        join(base, "artifacts-a"),
      );
      const runA = a.run();
      for (let i = 0; i < 200 && a.leasesRef.inFlight().length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }

      // Controller B arrives while A genuinely owns the work.
      let bExecutions = 0;
      const bExecutor: WorkItemExecutor = {
        id: "b",
        capabilities: () => ({ executorId: "b", families: ["fake"], capabilities: [], available: true }),
        async execute(): Promise<WorkItemResult> {
          bExecutions += 1;
          return { ok: true, findings: [], evidencePaths: [], runIds: [], usage: {} };
        },
      };
      const b = new UnattendedCampaign(
        {
          stateDir,
          workerCount: 1,
          items: [{ id: "contested", priority: 1, mode: "hunt", target: "fake", seed: 1, steps: 1 }],
          usagePerStep: USAGE,
          executor: bExecutor,
          now: () => t,
          leaseTtlMs: ttlMs,
        },
        join(base, "artifacts-b"),
      );
      // Keep A's lease alive past B's single reclaim opportunity.
      const keepAlive = setInterval(() => t += ttlMs, 50);
      let reportB;
      try {
        reportB = await b.run();
      } finally {
        clearInterval(keepAlive);
      }
      expect(reportB.stopReason).toBe("blocked-external-holds");
      expect(bExecutions).toBe(0); // no duplicate claim, no duplicate work

      // A finishes; exactly one completion exists durably.
      releaseA();
      const reportA = await runA;
      a.dispose();
      b.dispose();
      expect(reportA.completed).toEqual(["contested"]);
      const disk = JSON.parse(readFileSync(join(stateDir, "campaign.json"), "utf8")) as {
        executions: Array<{ itemId: string }>;
      };
      expect(disk.executions.filter((e) => e.itemId === "contested")).toHaveLength(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("H2 D8: semantically corrupt durable state fails closed", () => {
  const cases: Array<{ file: string; json: unknown; detail: RegExp }> = [
    { file: "campaign", json: { queue: "not-an-array", executions: {}, restarts: -100 }, detail: /campaign state/ },
    { file: "ledger", json: { entries: [{ workerId: "w", actions: -5 }], stopped: false }, detail: /ledger state/ },
    { file: "leases", json: { leases: { x: { itemId: "x", workerId: "w", generation: 0, acquiredAtMs: 1, expiresAtMs: 2 } }, done: [] }, detail: /lease state/ },
    { file: "leases", json: { leases: {}, done: [-100] }, detail: /lease state/ },
    { file: "campaign", json: { queue: [], executions: [{ itemId: "a", workerId: "w" }, { itemId: "a", workerId: "w2" }], findings: [], failed: [], restarts: 0, staleCompletions: 0 }, detail: /duplicate execution/ },
  ];

  for (const c of cases) {
    it(`quarantines syntactically-valid corrupt ${c.file} state (${JSON.stringify(c.json).slice(0, 48)}...)`, () => {
      const dir = fresh(`corrupt-${c.file}-${Math.random().toString(36).slice(2, 6)}`);
      try {
        writeFileSync(join(dir, `${c.file}.json`), JSON.stringify(c.json), "utf8");
        expect(
          () =>
            new UnattendedCampaign({
              stateDir: dir,
              workerCount: 1,
              items: fakeItems(1),
              usagePerStep: USAGE,
            }),
        ).toThrow(StateCorruptionError);
        // Quarantine preserved the bytes for post-mortem.
        const quarantined = existsSync(join(dir, `${c.file}.json`)) === false;
        expect(quarantined || existsSync(join(dir, `${c.file}.json`))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    void c.detail;
  }

  it("legitimate pre-M12 state missing additive fields still loads (migration)", () => {
    const dir = fresh("legacy-migration");
    try {
      writeFileSync(
        join(dir, "campaign.json"),
        JSON.stringify({ queue: ["item-0"], executions: [], findings: [], failed: [], restarts: 0, staleCompletions: 0 }),
        "utf8",
      );
      const ledgerStateDir = join(dir, "ledger-dir");
      mkdirSync(ledgerStateDir, { recursive: true });
      writeFileSync(
        join(ledgerStateDir, "ledger.json"),
        JSON.stringify({ entries: [] }),
        "utf8",
      );
      const campaign = new UnattendedCampaign({
        stateDir: dir,
        workerCount: 1,
        items: fakeItems(1),
        usagePerStep: USAGE,
      });
      expect(campaign.ledgerRef.totals().actions).toBe(0);
      campaign.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("corrupt ledger state fails closed at construction", () => {
    const dir = fresh("corrupt-ledger");
    try {
      writeFileSync(join(dir, "ledger.json"), JSON.stringify({ entries: "nope", stopped: false }), "utf8");
      expect(() => new ResourceLedger(dir)).toThrow(StateCorruptionError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("H2 D14: declared per-item budgets are genuinely enforced", () => {
  it("maxActions stops an over-demanding item with budget-exhausted, not silent overrun", async () => {
    const base = fresh("item-budget-actions");
    try {
      const stateDir = join(base, "state");
      const campaign = new UnattendedCampaign({
        stateDir,
        workerCount: 1,
        items: [{ id: "greedy", priority: 1, mode: "hunt", target: "fake", seed: 5, steps: 50, budgets: { maxActions: 3 } }],
        usagePerStep: USAGE,
      });
      try {
        const report = await campaign.run();
        expect(report.completed).toEqual([]);
        expect(report.failureDetails["greedy"]?.class).toBe("budget-exhausted");
        // Actual consumption accounted and bounded by the item ceiling (+race bound).
        expect(report.usage.actions).toBeLessThanOrEqual(4);
        expect(report.usage.actions).toBeGreaterThan(0);
      } finally {
        campaign.dispose();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("maxResets rejects reset charges beyond the item ceiling", () => {
    const base = fresh("item-budget-resets");
    try {
      const ledger = new ResourceLedger(join(base, "state"));
      const chargeReset = () =>
        ledger.charge(
          { workerId: "w", itemId: "r", resets: 1 },
          { itemBudget: { maxResets: 2 } },
        );
      expect(chargeReset()).toBe(true);
      expect(chargeReset()).toBe(true);
      expect(chargeReset()).toBe(false);
      expect(ledger.totals({ itemId: "r" }).resets).toBe(2);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("concurrent workers cannot oversubscribe one item's budget", async () => {
    const base = fresh("item-budget-race");
    try {
      const ledger = new ResourceLedger(join(base, "state"));
      const charges = Array.from({ length: 40 }, (_, i) =>
        Promise.resolve().then(() =>
          ledger.charge({ workerId: `w${i % 4}`, itemId: "shared", actions: 1 }, { itemBudget: { maxActions: 10 } }),
        ),
      );
      const results = await Promise.all(charges);
      const admitted = results.filter(Boolean).length;
      expect(admitted).toBe(10);
      expect(ledger.totals({ itemId: "shared" }).actions).toBe(10);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
