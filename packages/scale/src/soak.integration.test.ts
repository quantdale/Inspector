import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LeaseManager,
  ModelRouter,
  ResourceLedger,
  StateCorruptionError,
  StateFile,
  UnattendedCampaign,
  type CampaignReport,
  type ModelProvider,
  type UsageEntry,
  type WorkItem,
} from "./index.js";

// SOAK phase J (hardening campaign #1): bounded-but-substantial deterministic
// long-run churn for @inspector/scale. Everything is clock-injected; no real
// sleeps. Measured numbers are printed as `[soak-j] ...` lines for the
// campaign report.

const TMP_PREFIX = "inspector-soakj-scale-";
const roots: string[] = [];
function fresh(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${TMP_PREFIX}${name}-`));
  roots.push(dir);
  return dir;
}
let tmpBaseline = -1;
function countTmpRoots(): number {
  return readdirSync(tmpdir()).filter((f) => f.startsWith(TMP_PREFIX)).length;
}
beforeAll(() => {
  tmpBaseline = countTmpRoots();
});
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots.length = 0;
  // Dispose paths must leave the temp dir exactly as we found it.
  expect(countTmpRoots()).toBe(tmpBaseline);
});

interface SoakSample {
  rssMb: number;
  handles: number;
  byType: Record<string, number>;
}
function sampleResources(): SoakSample {
  const info = process.getActiveResourcesInfo();
  const byType: Record<string, number> = {};
  for (const r of info) byType[r] = (byType[r] ?? 0) + 1;
  return { rssMb: process.memoryUsage().rss / (1024 * 1024), handles: info.length, byType };
}
/** Generous, documented, CI-noise-tolerant ceilings — not perf assertions. */
function assertNoResourceBlowup(start: SoakSample, end: SoakSample, iterations: number, label: string): void {
  const growthMb = end.rssMb - start.rssMb;
  console.info(
    `[soak-j] ${label}: rss ${start.rssMb.toFixed(1)}MB -> ${end.rssMb.toFixed(1)}MB ` +
      `(growth ${growthMb.toFixed(1)}MB), active resources ${start.handles} -> ${end.handles}`,
  );
  expect(growthMb).toBeLessThan(200);
  expect(end.handles).toBeLessThanOrEqual(start.handles + 100);
  expect(end.handles).toBeLessThan(start.handles + Math.max(20, 0.5 * iterations));
}

const USAGE = { modelRequests: 1, tokens: 100, costUsd: 0.01, actions: 2 };

function makeItems(n: number): WorkItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i + 1}`,
    priority: (i % 5) + 1,
    mode: (["hunt", "regression", "repair"] as const)[i % 3]!,
    target: "fake",
    seed: 11 + i,
    steps: 2,
  }));
}

type ExecuteItemImpl = (
  this: unknown,
  item: WorkItem,
  workerId: string,
  generation?: number,
) => Promise<boolean>;

/** Prototype-level seam (same discipline as scale.hardening.test.ts). */
function patchExecuteItem(
  impl: (
    this: unknown,
    item: WorkItem,
    workerId: string,
    generation: number | undefined,
    runReal: () => Promise<boolean>,
  ) => Promise<boolean>,
): () => void {
  const proto = UnattendedCampaign.prototype as unknown as { executeItem: ExecuteItemImpl };
  const original = proto.executeItem;
  proto.executeItem = function (...args: unknown[]) {
    const item = args[0] as WorkItem;
    const workerId = args[1] as string;
    const generation = args[2] as number | undefined;
    return impl.call(this, item, workerId, generation, () =>
      original.apply(this, args as Parameters<ExecuteItemImpl>),
    );
  };
  return () => {
    proto.executeItem = original;
  };
}

interface ChurnCtx {
  t: number;
  ttlMs: number;
  completionsThisCycle: number;
  chunkSize: number;
  /** Wrapper invocations (attempt-level); drives injection scheduling. */
  attempts: number;
  /** Wrapper invocations that reached the real execution body. */
  realBodyRuns: number;
  staleInjections: number;
  duplicateClaimsRejected: number;
  workerFailures: number;
  failedOnce: Set<string>;
  admittedCharges: number;
  admittedActions: number;
  admittedTokens: number;
  admittedCostUsd: number;
}

describe("SOAK-J: unattended-campaign long-run churn", () => {
  it(
    "SOAK-J1: 160 items / 4 workers survive 20+ restart injections with exactly-once work",
    { timeout: 240_000 },
    async () => {
      const base = fresh("churn");
      const stateDir = join(base, "state");
      const artifactsDir = join(base, "artifacts");
      const items = makeItems(160);
      const ttlMs = 5_000;

      const ctx: ChurnCtx = {
        t: 1_700_000_000_000,
        ttlMs,
        completionsThisCycle: 0,
        chunkSize: 5, // stop after ~5 items per controller life -> constant restarts
        attempts: 0,
        realBodyRuns: 0,
        staleInjections: 0,
        duplicateClaimsRejected: 0,
        workerFailures: 0,
        failedOnce: new Set<string>(),
        admittedCharges: 0,
        admittedActions: 0,
        admittedTokens: 0,
        admittedCostUsd: 0,
      };

      const startResources = sampleResources();
      let midResources: SoakSample | null = null;
      const allCompleted = new Set<string>();
      let cycles = 0;
      let lastReport: CampaignReport | undefined;
      let staleSeen = 0;
      let failuresSeen = 0;
      const MAX_CYCLES = 90;
      const t0 = Date.now();

      const restore = patchExecuteItem(async function (item, _workerId, _generation, runReal) {
        const camp = this as UnattendedCampaign;
        ctx.attempts += 1;
        // Injected worker failure (once per item): contained crash before any work.
        if (ctx.attempts % 11 === 3 && !ctx.failedOnce.has(item.id)) {
          ctx.failedOnce.add(item.id);
          ctx.workerFailures += 1;
          throw new Error(`injected worker crash for ${item.id}`);
        }
        // Injected lease-TTL expiry + ghost-controller reclaim mid-run: the
        // current holder's completion must be fenced out as stale.
        if (ctx.attempts % 7 === 5) {
          ctx.t += ctx.ttlMs + 1; // expire the lease the campaign just acquired
          const ghost = camp.leasesRef.acquire(item.id, "worker-ghost");
          if (ghost.ok) {
            ctx.staleInjections += 1;
            const duplicate = camp.leasesRef.acquire(item.id, "worker-ghost-2");
            if (!duplicate.ok) ctx.duplicateClaimsRejected += 1; // held: double claim rejected
          }
        }
        ctx.realBodyRuns += 1;
        const ok = await runReal();
        if (ok) {
          ctx.completionsThisCycle += 1;
          if (ctx.completionsThisCycle >= ctx.chunkSize) camp.stop(); // restart between items
        }
        return ok;
      });

      try {
        while (cycles < MAX_CYCLES && allCompleted.size < items.length) {
          cycles += 1;
          if (cycles === 21) midResources = sampleResources();
          ctx.completionsThisCycle = 0;
          const completedBefore = allCompleted.size;

          const campaign = new UnattendedCampaign(
            {
              stateDir,
              workerCount: 4,
              items,
              usagePerStep: USAGE,
              now: (): number => ctx.t,
              leaseTtlMs: ttlMs,
            },
            artifactsDir,
          );
          // Tap every admitted charge so durable totals can be cross-checked.
          const led = campaign.ledgerRef;
          const origCharge = led.charge.bind(led);
          led.charge = (entry: UsageEntry): boolean => {
            const ok = origCharge(entry);
            if (ok) {
              ctx.admittedCharges += 1;
              ctx.admittedActions += entry.actions ?? 0;
              ctx.admittedTokens += entry.tokens ?? 0;
              ctx.admittedCostUsd += entry.costUsd ?? 0;
            }
            return ok;
          };
          if (cycles > 1) {
            ctx.t += ttlMs * 3; // controller downtime: in-flight leases expire
            campaign.injectRestart();
            campaign.resume(); // clear the durable stop left by the chunked shutdown
          }

          const report = await campaign.run();
          lastReport = report;
          for (const id of report.completed) allCompleted.add(id);
          campaign.dispose();

          // Per-iteration invariants: charged == recorded usage across restarts.
          const diskTotals = new ResourceLedger(stateDir).totals();
          expect(diskTotals.actions).toBe(ctx.admittedActions);
          expect(diskTotals.tokens).toBe(ctx.admittedTokens);
          expect(diskTotals.modelRequests).toBe(ctx.admittedCharges);
          expect(diskTotals.costUsd).toBeCloseTo(ctx.admittedCostUsd, 6);
          // Exactly-once within this pass: no duplicated committed work.
          const execIds = report.executions.map((e) => e.itemId);
          expect(new Set(execIds).size).toBe(execIds.length);

          // Progress = new completions + newly fenced stales + injected
          // failures this cycle; a cycle with none of the three is a stall.
          const progress =
            allCompleted.size - completedBefore +
            (report.staleCompletions - staleSeen) +
            (ctx.workerFailures - failuresSeen);
          staleSeen = report.staleCompletions;
          failuresSeen = ctx.workerFailures;
          if (progress === 0 && allCompleted.size < items.length) {
            throw new Error(
              `soak stalled after ${cycles} cycles: completed=${allCompleted.size}/${items.length} ` +
                `failed=${report.failed.length} stale=${report.staleCompletions}`,
            );
          }
        }
      } finally {
        restore();
      }

      const wallMs = Date.now() - t0;
      const endResources = sampleResources();

      // Termination: every item eventually committed exactly once.
      expect(allCompleted.size).toBe(items.length);
      expect(cycles).toBeLessThan(MAX_CYCLES);
      expect(lastReport).toBeDefined();
      if (!lastReport) throw new Error("unreachable");

      // Restarts really happened, many times, and are durably counted.
      expect(cycles - 1).toBeGreaterThanOrEqual(20);
      expect(lastReport.restartsInjected).toBe(cycles - 1);

      // Fencing: every injected reclaim produced exactly one rejected stale
      // completion, and duplicate claims were always refused.
      expect(lastReport.staleCompletions).toBe(ctx.staleInjections);
      expect(ctx.staleInjections).toBeGreaterThanOrEqual(10);
      expect(ctx.duplicateClaimsRejected).toBe(ctx.staleInjections);

      // Worker failures were contained and every failed item was retried to
      // success by a later restart: no permanently lost work.
      expect(ctx.workerFailures).toBeGreaterThanOrEqual(5);
      expect(lastReport.failed).toEqual([]);

      // Findings are persisted per executed body and never duplicated.
      expect(lastReport.findings.length).toBe(ctx.realBodyRuns);
      expect(lastReport.clusters).toBeGreaterThanOrEqual(1);
      expect(lastReport.clusters).toBeLessThanOrEqual(lastReport.findings.length);

      // Global exactly-once over durable state.
      const disk = JSON.parse(
        readFileSync(join(stateDir, "campaign.json"), "utf8"),
      ) as {
        executions: Array<{ itemId: string; workerId: string }>;
        failed: string[];
        queue: string[];
      };
      const counts = new Map<string, number>();
      for (const e of disk.executions) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1);
      expect(counts.size).toBe(items.length);
      for (const [, n] of counts) expect(n).toBe(1);
      expect(disk.failed).toEqual([]);
      expect(disk.queue).toEqual([]);

      // Expired-lease recovery drained every lease: nothing left in flight.
      const leasesAtEnd = new LeaseManager(stateDir, (): number => ctx.t, ttlMs);
      expect(leasesAtEnd.inFlight()).toHaveLength(0);

      // Ledger end-state equals the sum of admitted charges (durable truth).
      const finalTotals = new ResourceLedger(stateDir).totals();
      expect(finalTotals.actions).toBe(ctx.admittedActions);
      expect(finalTotals.modelRequests).toBe(ctx.admittedCharges);

      assertNoResourceBlowup(startResources, endResources, cycles, "J1 campaign churn");
      if (midResources) {
        console.info(
          `[soak-j] J1 mid-run sample at cycle 21: rss ${midResources.rssMb.toFixed(1)}MB, resources ${midResources.handles}`,
        );
      }
      console.info(
        `[soak-j] J1 shape: ${items.length} items x ${2} steps, workerCount=4, cycles=${cycles}, ` +
          `restarts=${cycles - 1}, realBodyRuns=${ctx.realBodyRuns}, staleInjections=${ctx.staleInjections}, ` +
          `workerFailures=${ctx.workerFailures}, charges=${ctx.admittedCharges}, wallMs=${wallMs}`,
      );
    },
  );

  it(
    "SOAK-J2: budget exhaustion fails a durable tail and never overspends",
    { timeout: 120_000 },
    async () => {
      const base = fresh("budget");
      const stateDir = join(base, "state");
      const items = makeItems(40); // 40 items x 2 steps x 2 actions = 160 actions demanded
      const budget = { maxActions: 140 }; // admits exactly 35 items

      const campaign = new UnattendedCampaign(
        { stateDir, workerCount: 3, items, usagePerStep: USAGE, globalBudget: budget },
        join(base, "artifacts"),
      );
      const report = await campaign.run();

      expect(report.completed).toHaveLength(35);
      expect(report.failed).toHaveLength(5);
      expect(new Set([...report.completed, ...report.failed]).size).toBe(40);
      expect(report.usage.actions).toBe(140);
      expect(report.usage.tokens).toBe(7000);
      expect(report.usage.modelRequests).toBe(70);
      expect(report.usage.costUsd).toBeCloseTo(0.7, 6);
      expect(report.staleCompletions).toBe(0);
      expect(campaign.leasesRef.inFlight()).toHaveLength(0); // failed items released their leases

      // Failed tail is durable and stays stable across a restart+retry.
      const diskAfterFirst = JSON.parse(
        readFileSync(join(stateDir, "campaign.json"), "utf8"),
      ) as { failed: string[]; executions: Array<{ itemId: string }> };
      expect(diskAfterFirst.failed.sort()).toEqual(report.failed.sort());

      const restarted = new UnattendedCampaign(
        { stateDir, workerCount: 3, items, usagePerStep: USAGE, globalBudget: budget },
        join(base, "artifacts"),
      );
      restarted.injectRestart();
      const second = await restarted.run();
      expect(second.completed).toHaveLength(35);
      expect(second.failed.sort()).toEqual(report.failed.sort());
      expect(second.usage.actions).toBe(140); // no additional spend admitted
      expect(second.restartsInjected).toBe(1);
      restarted.dispose();

      // Fresh ledger instance reads identical durable totals.
      const totals = new ResourceLedger(stateDir, budget).totals();
      expect(totals.actions).toBe(140);
      console.info(
        `[soak-j] J2 budget: completed=${report.completed.length} failedDurable=${report.failed.length} ` +
          `actions=${totals.actions}/${budget.maxActions}`,
      );
    },
  );

  it(
    "SOAK-J3: lease fencing storm — duplicate claims, expiry reclaims, stale writes rejected",
    { timeout: 180_000 },
    () => {
      const dir = fresh("fencing");
      let t = 10_000;
      const now = (): number => t;
      const ttl = 1_000;
      const a = new LeaseManager(dir, now, ttl);
      const b = new LeaseManager(dir, now, ttl);
      const ROUNDS = 250;
      let duplicateClaimsRejected = 0;
      let staleCompletionsRejected = 0;
      let staleRenewsRejected = 0;
      let reclaims = 0;
      let safeReleases = 0;

      for (let round = 0; round < ROUNDS; round++) {
        const item = `item-${round}`;
        const first = round % 2 === 0 ? a : b;
        const second = round % 2 === 0 ? b : a;
        const w1 = `w-${round}-a`;
        const w2 = `w-${round}-b`;

        const g1 = first.acquire(item, w1);
        if (!g1.ok) throw new Error(`round ${round}: initial acquire failed`);
        expect(g1.lease.generation).toBe(1);

        // Duplicate claim attempts while unexpired: both managers must lose.
        for (const dup of [first.acquire(item, w1), second.acquire(item, w2)]) {
          if (dup.ok) throw new Error(`round ${round}: duplicate claim succeeded`);
          expect(dup.reason).toBe("held");
          duplicateClaimsRejected += 1;
        }

        // TTL passes: the lease becomes reclaimable by anyone, generation bumps.
        t += ttl + 1;
        const g2 = second.acquire(item, w2);
        if (!g2.ok) throw new Error(`round ${round}: expired lease not reclaimable`);
        reclaims += 1;
        expect(g2.lease.generation).toBe(2);

        // The pre-expiry holder can no longer renew or complete (stale generation).
        expect(first.renew(item, w1, 1)).toBe(false);
        staleRenewsRejected += 1;
        expect(first.complete(item, w1, 1)).toBe(false);
        staleCompletionsRejected += 1;

        // Old owner releasing must not drop the new owner's lease.
        first.release(item, w1);
        const stillHeld = second.inFlight(t).find((l) => l.itemId === item);
        if (!stillHeld || stillHeld.workerId !== w2) {
          throw new Error(`round ${round}: stale release dropped a live lease`);
        }
        safeReleases += 1;

        // Current generation flows through renew -> complete -> done.
        t += ttl / 2;
        expect(second.renew(item, w2, 2)).toBe(true);
        expect(second.complete(item, w2, 2)).toBe(true);
        expect(second.isDone(item)).toBe(true);
      }

      expect(reclaims).toBe(ROUNDS);
      expect(duplicateClaimsRejected).toBe(ROUNDS * 2);
      expect(staleCompletionsRejected).toBe(ROUNDS);
      expect(staleRenewsRejected).toBe(ROUNDS);
      expect(safeReleases).toBe(ROUNDS);

      // Done set is durable: a fresh manager sees no in-flight leases and the
      // sampled done items stay done.
      const freshManager = new LeaseManager(dir, now, ttl);
      expect(freshManager.inFlight()).toHaveLength(0);
      for (let round = 0; round < ROUNDS; round += 10) {
        expect(freshManager.isDone(`item-${round}`)).toBe(true);
      }
      console.info(
        `[soak-j] J3 fencing: rounds=${ROUNDS}, duplicateClaimsRejected=${duplicateClaimsRejected}, ` +
          `reclaims=${reclaims}, staleCompletionsRejected=${staleCompletionsRejected}, safeReleases=${safeReleases}`,
      );
    },
  );

  it(
    "SOAK-J4: model-router fallback storm routes correctly under continuous provider failure",
    { timeout: 120_000 },
    async () => {
      const hits: Record<string, number> = {};
      function makeProvider(id: string, priority: number, throwsOn: (i: number) => boolean): ModelProvider {
        return {
          id,
          priority,
          roles: ["planner"],
          costPer1kTokens: 0.01,
          healthy: true,
          complete: async (input: string): Promise<string> => {
            if (throwsOn(Number(input))) throw new Error(`${id} unavailable`);
            hits[id] = (hits[id] ?? 0) + 1;
            return `${id}:${input}`;
          },
        };
      }
      const a = makeProvider("prov-a", 3, (i) => i % 3 !== 0);
      const b = makeProvider("prov-b", 2, (i) => i % 3 === 2);
      const c = makeProvider("prov-c", 1, () => false);
      const router = new ModelRouter().register(a).register(b).register(c);

      // Phase 1: deterministic fallback storm.
      const ITER = 3000;
      for (let i = 0; i < ITER; i++) {
        const res = await router.complete("planner", String(i));
        const expectedFallbacks =
          i % 3 === 0 ? [] : i % 3 === 1 ? ["prov-a"] : ["prov-a", "prov-b"];
        expect(res.fallbacksUsed).toEqual(expectedFallbacks);
        expect(res.output).toBe(`${res.provider.id}:${i}`);
      }
      expect(hits["prov-a"]).toBe(ITER / 3);
      expect(hits["prov-b"]).toBe(ITER / 3);
      expect(hits["prov-c"]).toBe(ITER / 3);

      // Phase 2: total outage escalates loudly instead of returning garbage.
      const dead = ["dead-1", "dead-2", "dead-3"].map((id, idx) =>
        makeProvider(id, 3 - idx, () => true),
      );
      const darkRouter = new ModelRouter().register(dead[0]!).register(dead[1]!).register(dead[2]!);
      for (let i = 0; i < 200; i++) {
        await expect(darkRouter.complete("planner", String(i))).rejects.toThrow(
          /all providers for role 'planner' failed: dead-1, dead-2, dead-3/,
        );
      }

      // Phase 3: health flapping — unhealthy providers are never candidates.
      for (let i = 0; i < 1000; i++) {
        a.healthy = i % 2 === 0;
        b.healthy = i % 4 !== 1;
        c.healthy = true;
        const chain = [
          { p: a, down: i % 3 !== 0 },
          { p: b, down: i % 3 === 2 },
          { p: c, down: false },
        ].filter((e) => e.p.healthy);
        const winnerIdx = chain.findIndex((e) => !e.down);
        if (winnerIdx < 0) throw new Error(`flap ${i}: no live provider in expectation`);
        const res = await router.complete("planner", String(i));
        expect(res.provider.id).toBe(chain[winnerIdx]!.p.id);
        expect(res.fallbacksUsed).toEqual(chain.slice(0, winnerIdx).map((e) => e.p.id));
        for (const candidate of router.candidates("planner")) {
          expect(candidate.healthy).toBe(true);
        }
      }

      // Unknown role has no providers at all: loud error, not a silent route.
      await expect(router.complete("summarizer", "x")).rejects.toThrow(/no healthy provider/);
      console.info(
        `[soak-j] J4 router storm: fallbackIterations=${ITER}, outageIterations=200, flapIterations=1000, hits=${JSON.stringify(hits)}`,
      );
    },
  );

  it(
    "SOAK-J5: repeated truncation quarantines corrupt state without silent resets",
    { timeout: 120_000 },
    () => {
      const dir = fresh("quarantine");
      const sfPath = join(dir, "soak.json");
      const sf = new StateFile<{ n: number }>(dir, "soak", () => ({ n: -1 }));
      const CYCLES = 24;

      for (let i = 0; i < CYCLES; i++) {
        sf.update((s) => {
          s.n = i;
        });
        const raw = readFileSync(sfPath);
        // Strict prefix of a JSON object document never parses: inject truncation.
        const cut = Math.max(1, Math.floor((raw.byteLength * (i + 1)) / (CYCLES + 2)));
        writeFileSync(sfPath, raw.subarray(0, cut));

        let quarantinePath = "";
        try {
          sf.load();
          throw new Error(`cycle ${i}: truncated state loaded without error`);
        } catch (err) {
          if (!(err instanceof StateCorruptionError)) throw err;
          const m = /quarantined to (.+)$/.exec(err.message);
          expect(m).not.toBeNull();
          quarantinePath = m![1]!;
        }
        expect(existsSync(sfPath)).toBe(false); // moved aside, not reset
        expect(existsSync(quarantinePath)).toBe(true); // bytes preserved for post-mortem
      }

      const files = readdirSync(dir);
      const quarantines = files.filter((f) => f.startsWith("soak.json.corrupt-"));
      expect(quarantines).toHaveLength(CYCLES);

      // After quarantine the store self-heals from initial state on next update.
      expect(sf.update((s) => s.n + 1)).toBe(0);
      console.info(`[soak-j] J5 quarantine: truncationCycles=${CYCLES}, quarantineFiles=${quarantines.length}`);
    },
  );
});
