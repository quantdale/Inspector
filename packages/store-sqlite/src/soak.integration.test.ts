import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "./index.js";

// SOAK phase J (hardening campaign #1): bounded-but-substantial deterministic
// churn for @inspector/store-sqlite — thousands of step/observation/checkpoint
// commits across repeated reopen cycles, with size-vs-rows accounting.
// Measured numbers are printed as `[soak-j] ...` lines for the campaign report.

const TMP_PREFIX = "inspector-soakj-db-";
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
  for (const dir of roots) removeDir(dir);
  roots.length = 0;
  // Dispose paths must leave the temp dir exactly as we found it.
  expect(countTmpRoots()).toBe(tmpBaseline);
});

/** Windows can hold file handles briefly after close; bounded retry. */
function removeDir(path: string): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

interface SoakSample {
  rssMb: number;
  handles: number;
}
function sampleResources(): SoakSample {
  return {
    rssMb: process.memoryUsage().rss / (1024 * 1024),
    handles: process.getActiveResourcesInfo().length,
  };
}

const CYCLES = 40;
const STEPS_PER_CYCLE = 80;
const RUNS_PER_CYCLE = 4;

describe("SOAK-J: sqlite durable-store long-run churn", () => {
  it(
    "SOAK-J7: thousands of commits survive repeated reopen cycles with exact row accounting",
    { timeout: 180_000 },
    () => {
      const base = fresh("db");
      const dbPath = join(base, "runs.db");
      const startResources = sampleResources();
      const t0 = Date.now();

      // Churn phases: each cycle opens a fresh Store (schema idempotent),
      // commits steps/observations/checkpoints plus pending-action recovery
      // churn, then closes — a full reopen cycle every time.
      for (let c = 0; c < CYCLES; c++) {
        const store = Store.open(dbPath);
        try {
          for (let r = 0; r < RUNS_PER_CYCLE; r++) {
            const runId = `run_${c}_${r}`;
            const envId = `env_${c}_${r}`;
            store.createRun({ id: runId, adapter: "adapter-fake" });
            store.createEnvironment({ id: envId, runId, adapter: "adapter-fake" });
            const perRun = STEPS_PER_CYCLE / RUNS_PER_CYCLE;
            for (let s = 0; s < perRun; s++) {
              store.commitStep({
                stepId: `step_${c}_${r}_${s}`,
                runId,
                environmentId: envId,
                sequence: s,
                action: {
                  id: `act_${c}_${r}_${s}`,
                  kind: "click",
                  risk: "interact",
                  deadlineMs: 5000,
                  idempotency: "safe-retry",
                  status: "success",
                  stateAfter: `state_${s}`,
                },
                observations: [
                  {
                    id: `obs_a_${c}_${r}_${s}`,
                    stepId: `step_${c}_${r}_${s}`,
                    sequence: s * 2,
                    source: "pre",
                    capturedAt: new Date().toISOString(),
                    summary: { i: s },
                    artifacts: [
                      {
                        sha256: "ab".repeat(32),
                        mime: "text/plain",
                        size: 32,
                        path: `art/${c}/${r}/${s}`,
                      },
                    ],
                  },
                  {
                    id: `obs_b_${c}_${r}_${s}`,
                    stepId: `step_${c}_${r}_${s}`,
                    sequence: s * 2 + 1,
                    source: "post",
                    capturedAt: new Date().toISOString(),
                    summary: { i: s, ok: true },
                  },
                ],
              });
              if (s % 10 === 0) {
                // Adapter-loss churn: pending action becomes unknown exactly once.
                const pend = store.insertPendingAction({
                  id: `pend_${c}_${r}_${s}`,
                  runId,
                  environmentId: envId,
                  kind: "click",
                  risk: "interact",
                  deadlineMs: 5000,
                  idempotency: `retry_${c}_${r}_${s}`,
                });
                expect(pend.inserted).toBe(true);
                const again = store.insertPendingAction({
                  id: `pend_${c}_${r}_${s}`,
                  runId,
                  environmentId: envId,
                  kind: "click",
                  risk: "interact",
                  deadlineMs: 5000,
                  idempotency: `retry_${c}_${r}_${s}`,
                });
                expect(again.inserted).toBe(false); // idempotent resubmission
                const lost = store.markInFlightUnknown(runId);
                expect(lost).toHaveLength(1);
                expect(lost[0]!.status).toBe("pending");
              }
              if (s % 4 === 0) {
                store.writeCheckpoint({
                  id: `cp_${c}_${r}_${s}`,
                  runId,
                  stepId: `step_${c}_${r}_${s}`,
                  payload: { c, r, s },
                });
              }
            }
          }
        } finally {
          store.close();
        }
      }

      const wallMs = Date.now() - t0;

      // Size-vs-rows accounting on the closed database.
      const dbBytes = statSync(dbPath).size;
      const expectedSteps = CYCLES * STEPS_PER_CYCLE;
      const runsTotal = CYCLES * RUNS_PER_CYCLE;
      const perRun = STEPS_PER_CYCLE / RUNS_PER_CYCLE;
      const pendingsPerRun = Math.floor((perRun - 1) / 10) + 1; // s % 10 === 0
      const checkpointsPerRun = Math.floor((perRun - 1) / 4) + 1; // s % 4 === 0
      const expectedActions = expectedSteps + runsTotal * pendingsPerRun;
      const expectedCheckpoints = runsTotal * checkpointsPerRun;

      console.info(
        `[soak-j] J7 db: cycles=${CYCLES} reopenCycles=${CYCLES} steps=${expectedSteps} ` +
          `dbBytes=${dbBytes} (${(dbBytes / 1024).toFixed(0)}KiB, ${(dbBytes / expectedSteps).toFixed(0)} bytes/step), wallMs=${wallMs}`,
      );
      expect(dbBytes).toBeLessThan(64 * 1024 * 1024); // generous runaway-growth ceiling
      expect(existsSync(`${dbPath}-wal`)).toBe(false); // clean close checkpoints the WAL away
      expect(existsSync(`${dbPath}-shm`)).toBe(false);

      // Final verification pass over a fresh open.
      const store = Store.open(dbPath);
      try {
        const count = (table: string): number =>
          (store.raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
        expect(count("steps")).toBe(expectedSteps);
        expect(count("actions")).toBe(expectedActions);
        expect(count("observations")).toBe(expectedSteps * 2);
        expect(count("observation_artifacts")).toBe(expectedSteps);
        expect(count("checkpoints")).toBe(expectedCheckpoints);
        expect(count("runs")).toBe(runsTotal);
        expect(count("environments")).toBe(runsTotal);

        // Ordered history survives reopens: sequences strictly increasing.
        const bundle = store.getRunSteps(`run_0_0`);
        expect(bundle).toHaveLength(perRun);
        for (let s = 0; s < bundle.length; s++) {
          expect(bundle[s]!.step.sequence).toBe(s);
          expect(bundle[s]!.action?.status).toBe("success");
          expect(bundle[s]!.observations).toHaveLength(2);
          expect(bundle[s]!.observations[0]!.sequence).toBe(s * 2);
          expect(bundle[s]!.observations[1]!.sequence).toBe(s * 2 + 1);
        }

        // Recovery churn is durable and idempotent across reopens: the
        // pending actions of earlier cycles stay 'unknown', never re-lost.
        const unknownCount = (
          store.raw
            .prepare(`SELECT COUNT(*) AS c FROM actions WHERE status = 'unknown'`)
            .get() as { c: number }
        ).c;
        expect(unknownCount).toBe(runsTotal * pendingsPerRun);
        const lostAgain = store.markInFlightUnknown(`run_0_0`);
        expect(lostAgain).toHaveLength(0); // repeated resumes do not multiply recoveries

        // Latest checkpoint is addressable and payload-faithful.
        const lastCp = store.getLatestCheckpoint(`run_${CYCLES - 1}_${RUNS_PER_CYCLE - 1}`);
        expect(lastCp?.payload_json).toBe(
          JSON.stringify({ c: CYCLES - 1, r: RUNS_PER_CYCLE - 1, s: Math.floor((perRun - 1) / 4) * 4 }),
        );

        // One more reopen still sees everything (durability, not cache).
        store.close();
        const reopened = Store.open(dbPath);
        try {
          expect(
            (reopened.raw.prepare(`SELECT COUNT(*) AS c FROM steps`).get() as { c: number }).c,
          ).toBe(expectedSteps);
        } finally {
          reopened.close();
        }
      } finally {
        store.close();
      }

      const endResources = sampleResources();
      const growthMb = endResources.rssMb - startResources.rssMb;
      console.info(
        `[soak-j] J7 resources: rss ${startResources.rssMb.toFixed(1)}MB -> ${endResources.rssMb.toFixed(1)}MB ` +
          `(growth ${growthMb.toFixed(1)}MB), active resources ${startResources.handles} -> ${endResources.handles}`,
      );
      expect(growthMb).toBeLessThan(200);
      expect(endResources.handles).toBeLessThanOrEqual(startResources.handles + 100);
      expect(endResources.handles).toBeLessThan(startResources.handles + Math.max(20, 0.5 * CYCLES));
    },
  );
});
