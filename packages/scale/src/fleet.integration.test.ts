import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FindingEngine, OracleEngine } from "@inspector/finding";
import { WebReplayDriver } from "@inspector/explore";
import { AndroidReplayDriver } from "@inspector/android";

import { LeaseManager } from "./leases.js";
import { ResourceLedger } from "./ledger.js";
import { StateCorruptionError, StateFile } from "./state-file.js";
import {
  EffectsLedger,
  FENCE_ITEM_ID,
  FleetController,
  FleetRouter,
  PidTracker,
  auditStateFiles,
  emptyFleetState,
  emptyFleetTelemetry,
  makeAndroidExecutor,
  makeCliExecutor,
  makeElectronExecutor,
  makeWebExecutor,
  makeWindowsExecutor,
  runFenceProbe,
  sampleResources,
  sleep,
} from "./fleet-harness.js";
import type {
  ChaosState,
  FleetItem,
  FleetState,
  FleetTelemetry,
  LaneExecutor,
  LaneKind,
  ResourceSample,
} from "./fleet-harness.js";

// FLEET CAMPAIGN: several independent targets run CONCURRENTLY through an
// unattended, chaos-injected, lease-guarded campaign on ONE shared durable
// state directory, asserting a strict invariant checklist (exactly-once
// externally visible work, durable state integrity, finding hygiene, resource
// bounds, full cleanup). This simulates production unattended operation.
//
// HONEST LIMITS: WEB and ELECTRON are REAL targets — actual adapter
// subprocesses (`node --import tsx .../bin.ts`) running Playwright Chromium
// against the seeded app. The CLI, Android, and Windows lanes run on the
// project's injectable mock backends (MockPtyBackend, MockAdbBackend,
// MockUiaBackend): production PTY/ADB/UIA bindings do not exist in this
// environment (spec blocker policy). The adapter contracts exercised are the
// same ones the production bindings implement.

const TMP_PREFIX = "inspector-fleet-";
/** Controller lives: initial + one restart per cumulative settlement threshold
 * (2nd/5th/9th settlement of the whole campaign — orphans included). */
const STOP_AFTER_SETTLED = [2, 5, 9];
/**
 * Global action budget: the deterministic mock-lane demand of all non-tail
 * items is exactly 53 actions (cli 6+10+2, android 6+12+5, windows churn 12).
 * 56 admits every non-tail charge and starves BOTH tail items durably.
 */
const GLOBAL_MAX_ACTIONS = 56;
const MOCK_ADMITTED_ACTIONS = 53;
const ROUTER_FAIL_FIRST_K = 2;

const roots: string[] = [];
function freshRoot(name: string): string {
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
});

function fleetItems(): FleetItem[] {
  return [
    { id: "web-1", lane: "web", seed: 11, kind: "explore", priority: 5 },
    // web-2 is the ADAPTER-KILL chaos target: its first attempt dies mid-item.
    { id: "web-2", lane: "web", seed: 23, kind: "explore", priority: 6 },
    { id: "web-3", lane: "web", seed: 47, kind: "explore", priority: 7 },
    { id: "elec-1", lane: "electron", seed: 0, kind: "traverse", priority: 8 },
    { id: "cli-churn", lane: "cli", seed: 0, kind: "churn", priority: 9 },
    { id: "cli-overflow", lane: "cli", seed: 0, kind: "overflow", priority: 10 },
    { id: "cli-eof", lane: "cli", seed: 0, kind: "eof", priority: 11 },
    { id: "and-confirm-boom", lane: "android", seed: 0, kind: "confirm-boom", priority: 12 },
    {
      id: "and-confirm-overflow",
      lane: "android",
      seed: 0,
      kind: "confirm-overflow",
      priority: 13,
    },
    { id: "and-rotation", lane: "android", seed: 0, kind: "rotation", priority: 14 },
    { id: "win-churn", lane: "windows", seed: 0, kind: "churn", priority: 15 },
    // Budget-exhaustion tail: admitted demand is 53 < 56 < 53+4, so both tail
    // items fail TERMINALLY mid-run once the global action budget is spent.
    { id: "win-tail-a", lane: "windows", seed: 0, kind: "miss", priority: 30 },
    { id: "win-tail-b", lane: "windows", seed: 0, kind: "miss", priority: 31 },
    // Lease-fencing probe runs OUTSIDE the queue as a dedicated chaos chore.
    {
      id: FENCE_ITEM_ID,
      lane: "cli",
      seed: 0,
      kind: "fence-probe",
      priority: 99,
      skipQueue: true,
    },
  ];
}

/**
 * CHAOS: ONE deliberate truncation of a NON-critical state file mid-run. The
 * typed StateCorruptionError must fire, the bytes must be quarantined (not
 * silently reset), and the store must self-heal on the next update.
 */
function truncateQuarantineProbe(stateDir: string): void {
  const sf = new StateFile<{ n: number }>(stateDir, "quarantine-probe", () => ({ n: 0 }));
  sf.update((s) => {
    s.n = 7;
  });
  const path = join(stateDir, "quarantine-probe.json");
  const raw = readFileSync(path);
  writeFileSync(path, raw.subarray(0, Math.floor((raw.byteLength * 2) / 3)));
  let quarantined = false;
  let quarantinePath = "";
  try {
    sf.load();
  } catch (err) {
    if (!(err instanceof StateCorruptionError)) throw err;
    quarantined = true;
    quarantinePath = /quarantined to (.+)$/.exec(err.message)?.[1] ?? "";
  }
  expect(quarantined).toBe(true);
  expect(existsSync(path)).toBe(false); // moved aside, not reset
  expect(quarantinePath.length).toBeGreaterThan(0);
  expect(existsSync(quarantinePath)).toBe(true); // bytes preserved for post-mortem
  expect(sf.update((s) => s.n + 1)).toBe(1); // self-heals from initial state
}

describe("FLEET: concurrent multi-target unattended campaign", () => {
  it(
    "runs web/electron/cli/android/windows lanes concurrently under restarts, kills, fencing, fallback and budget chaos with zero duplicate effects",
    { timeout: 480_000 },
    async () => {
      const root = freshRoot("campaign");
      const stateDir = join(root, "state");
      const effectsDir = join(root, "effects");
      const bundlesDir = join(root, "bundles");
      mkdirSync(bundlesDir, { recursive: true });

      const items = fleetItems();
      const pids = new PidTracker();
      const effects = new EffectsLedger(effectsDir);
      const telemetry = new StateFile<FleetTelemetry>(stateDir, "telemetry", emptyFleetTelemetry);
      const router = new FleetRouter(telemetry, ROUTER_FAIL_FIRST_K);
      const chaos: ChaosState = { killTargetItemId: "web-2", killArmed: true, killPid: null };

      const executors: Partial<Record<LaneKind, LaneExecutor>> = {
        web: makeWebExecutor({ pids, effects, bundlesDir, chaos }),
        electron: makeElectronExecutor({ pids }),
        cli: makeCliExecutor(),
        android: makeAndroidExecutor({ effects, bundlesDir }),
        windows: makeWindowsExecutor(),
      };

      const startSample: ResourceSample = sampleResources(TMP_PREFIX);
      const t0 = Date.now();

      // CHAOS (c): lease-TTL expiry -> reclaim -> generation-fenced stale
      // completion, running concurrently with the campaign.
      const fenceProbePromise = runFenceProbe({
        stateDir,
        ttlMs: 1200,
        stallMs: 3200,
        effects,
      });

      // Campaign driver: each life is a FULLY FRESH FleetController over the
      // SAME stateDir; stopping a life mid-queue tears the controller down
      // while in-flight items keep running as detached orphans (chaos a).
      const controllers: FleetController[] = [];
      let currentLife = 0;
      // Restart triggers are cumulative over ALL settlements (orphans
      // included): a boundary must fire while work remains, regardless of
      // which controller life's workers performed the settlements.
      let settledTotal = 0;

      // The budget-starved tail items join ONLY in the final life: by then
      // all 53 non-tail mock actions are durably spent, so the global budget
      // refusal (and the durable terminal tail) is deterministic regardless
      // of worker interleaving.
      const queueItems = (includeTail: boolean): FleetItem[] =>
        includeTail ? items : items.filter((i) => !i.id.startsWith("win-tail"));

      async function runLife(
        stopAfterSettled: number | null,
        includeTail = false,
      ): Promise<"drained" | "stopped"> {
        currentLife += 1;
        const life = currentLife;
        const controller = new FleetController(
          {
            stateDir,
            life,
            items: queueItems(includeTail),
            executors,
            workerCount: 4,
            globalBudget: { maxActions: GLOBAL_MAX_ACTIONS },
            // Counting only: boundary detection lives in the DRIVER below, so
            // settlements delivered by straggler orphan workers of EARLIER
            // lives advance the active boundary too.
            onSettled: () => {
              settledTotal += 1;
            },
          },
          { effects, router, pids, telemetry, bundlesDir, chaos },
        );
        controllers.push(controller);
        if (life > 1) controller.markRestart();
        const runPromise = controller.run();
        const drainedP = runPromise.then(() => "drained" as const);

        const boundary = async (): Promise<"stopped"> => {
          while (settledTotal < stopAfterSettled!) {
            await sleep(80);
          }
          // Signal FIRST: abandoning resolves runPromise (and thus drainedP)
          // immediately, so awaiting it here would let drainedP win the race
          // against our own stop decision.
          controller.abandon(); // scheduler halts at once; claims run on as orphans
          return "stopped";
        };

        const winner = await Promise.race(
          stopAfterSettled === null ? [drainedP] : [drainedP, boundary()],
        );
        if (winner !== "stopped") controller.abandon();
        await runPromise;
        console.info(
          `[fleet] life ${life} ended (${winner}); queue=${controller.loadState().queue.length}`,
        );
        return winner;
      }

      for (let i = 0; i < STOP_AFTER_SETTLED.length; i++) {
        const outcome = await runLife(STOP_AFTER_SETTLED[i]!);
        expect(outcome).toBe("stopped"); // every boundary was a MID-RUN teardown
        auditStateFiles(stateDir, `after-life-${currentLife}`);
        if (i === 1) truncateQuarantineProbe(stateDir);
      }
      const finalOutcome = await runLife(null, true);
      expect(finalOutcome).toBe("drained");

      const probe = await fenceProbePromise;
      // Every worker loop of every life — including detached orphans — exited.
      await Promise.all(controllers.map((c) => c.idle()));
      auditStateFiles(stateDir, "final");

      const wallMs = Date.now() - t0;
      const endSample: ResourceSample = sampleResources(TMP_PREFIX);

      // Durable truth, loaded fresh from disk.
      const finalState: FleetState = new StateFile<FleetState>(
        stateDir,
        "fleet",
        emptyFleetState,
      ).load();
      console.info(
        `[fleet] state: executions=${finalState.executions.length} failures=${finalState.failures.length} ` +
          `terminal=${JSON.stringify(finalState.terminalFailures)} stale=${finalState.staleCompletions} ` +
          `restarts=${finalState.restarts} findings=${finalState.findings.length} rotations=${finalState.rotations.length}`,
      );

      // -----------------------------------------------------------------
      // CHAOS OBSERVATIONS
      // -----------------------------------------------------------------
      expect(finalState.restarts).toBe(STOP_AFTER_SETTLED.length);
      expect(probe.reclaimedByChaos).toBe(true);
      expect(probe.staleCompletionRejected).toBe(true);
      expect(chaos.killArmed).toBe(false); // the kill fired exactly once
      expect(chaos.killPid).not.toBeNull();

      // -----------------------------------------------------------------
      // DRAIN + EXACTLY-ONCE EXECUTION
      // -----------------------------------------------------------------
      expect(finalState.queue).toEqual([]); // queue drained to empty
      const executedIds = finalState.executions.map((e) => e.itemId);
      const perItem = new Map<string, number>();
      for (const id of executedIds) perItem.set(id, (perItem.get(id) ?? 0) + 1);
      for (const [, n] of perItem) expect(n).toBe(1); // no item executed twice
      const expectedExecuted = new Set<string>([
        ...items
          .filter((i) => !i.skipQueue && !i.id.startsWith("win-tail"))
          .map((i) => i.id),
        FENCE_ITEM_ID,
      ]);
      expect(new Set(executedIds)).toEqual(expectedExecuted);

      // The fenced probe was executed EXACTLY ONCE — by the reclaimer.
      expect(finalState.executions.filter((e) => e.itemId === FENCE_ITEM_ID)).toEqual([
        { itemId: FENCE_ITEM_ID, workerId: "chaos-reclaimer", attempt: 1 },
      ]);

      // Kill chaos: web-2 failed durably (adapter-error), then its retry
      // completed — visible only once, with a fresh environment.
      const web2Failures = finalState.failures.filter((f) => f.itemId === "web-2");
      expect(web2Failures.length).toBeGreaterThanOrEqual(1);
      expect(web2Failures.some((f) => f.reason.kind === "adapter-error")).toBe(true);
      // No unexplained failures: only the injected kill and the budget tail.
      expect(
        finalState.failures.every(
          (f) => f.itemId === "web-2" || f.itemId.startsWith("win-tail"),
        ),
      ).toBe(true);

      // Budget exhaustion: a durable terminal tail, never overspent.
      expect([...finalState.terminalFailures].sort()).toEqual(["win-tail-a", "win-tail-b"]);
      for (const f of finalState.failures) {
        if (f.itemId.startsWith("win-tail")) {
          expect(f.reason.kind).toBe("budget-exhausted");
        }
      }

      // Stale completions are counted, never applied (probe + any orphans).
      expect(finalState.staleCompletions).toBeGreaterThanOrEqual(1);

      // -----------------------------------------------------------------
      // LEASE / STATE INTEGRITY
      // -----------------------------------------------------------------
      const leasesAtEnd = new LeaseManager(stateDir);
      expect(leasesAtEnd.inFlight()).toHaveLength(0); // no orphan held leases
      for (const id of executedIds) expect(leasesAtEnd.isDone(id)).toBe(true);
      const rawLeases = JSON.parse(readFileSync(join(stateDir, "leases.json"), "utf8")) as {
        done: string[];
      };
      expect(new Set(rawLeases.done)).toEqual(new Set(executedIds)); // done == executed

      // Exactly ONE quarantine exists — the deliberately injected one.
      const quarantines = readdirSync(stateDir).filter((f) => f.includes(".corrupt-"));
      expect(quarantines).toHaveLength(1);
      expect(quarantines[0]).toContain("quarantine-probe");

      // -----------------------------------------------------------------
      // EFFECTS LEDGER: mechanically provable no-duplicate-work
      // -----------------------------------------------------------------
      expect(effects.duplicates).toEqual([]); // ZERO duplicate-effect attempts
      const expectedMarkers =
        finalState.executions.length +
        2 * finalState.findings.length +
        finalState.rotations.length;
      expect(effects.written.length).toBe(expectedMarkers);

      // -----------------------------------------------------------------
      // LEDGER: charged == recorded usage, within budget
      // -----------------------------------------------------------------
      const totals = new ResourceLedger(stateDir).totals();
      expect(totals.actions).toBe(MOCK_ADMITTED_ACTIONS);
      expect(totals.actions).toBeLessThanOrEqual(GLOBAL_MAX_ACTIONS);
      expect(totals.modelRequests).toBeGreaterThanOrEqual(items.length - 3);
      expect(totals.tokens).toBeGreaterThan(0);

      // -----------------------------------------------------------------
      // MODEL ROUTER: fallback chains + escalation + telemetry capture
      // -----------------------------------------------------------------
      const events = router.events;
      const plannerEvents = events.filter((e) => e.role === "planner");
      // One planner route per successfully executed non-tail queue item.
      expect(plannerEvents.length).toBe(expectedExecuted.size - 1);
      const servedByMid = plannerEvents.filter((e) => e.provider === "prov-mid");
      expect(servedByMid.length).toBe(ROUTER_FAIL_FIRST_K);
      for (const e of servedByMid) expect(e.fallbacksUsed).toEqual(["prov-fast"]);
      const servedByFast = plannerEvents.filter((e) => e.provider === "prov-fast");
      expect(servedByFast.length).toBe(plannerEvents.length - ROUTER_FAIL_FIRST_K);
      for (const e of servedByFast) expect(e.fallbacksUsed).toEqual([]);
      const escalations = events.filter((e) => e.escalated);
      expect(escalations.length).toBeGreaterThanOrEqual(1);
      for (const e of escalations) {
        expect(e.provider).toBeNull();
        expect(e.role).toBe("summarizer");
        expect(e.error ?? "").toMatch(/prov-dead permanently offline|all providers for role/);
      }
      for (const e of events) {
        expect(e.latencyMs).toBeGreaterThanOrEqual(0);
        expect(e.tokens).toBeGreaterThan(0);
      }
      expect(telemetry.load().routerEvents.length).toBe(events.length);

      // -----------------------------------------------------------------
      // FINDING HYGIENE: every finding terminal, evidenced, reproducible
      // -----------------------------------------------------------------
      const findings = finalState.findings;
      console.info(
        `[fleet] findings: ${findings
          .map((f) => `${f.lane}/${f.finding.status}/${String(f.finding.signature)}`)
          .join(", ")}`,
      );
      expect(findings.length).toBeGreaterThanOrEqual(3);
      const transient = ["OBSERVED", "CANDIDATE", "REPRODUCING", "PATCHING", "VERIFYING"];
      for (const lf of findings) {
        expect(transient).not.toContain(lf.finding.status);
        expect(["CONFIRMED", "MINIMIZED"]).toContain(lf.finding.status);
        expect(lf.bundle.oracleEvidence.length).toBeGreaterThan(0);
        expect(lf.bundle.artifactRefs.length).toBeGreaterThan(0);
        expect(lf.regression.findingId).toBe(lf.finding.id);
        expect(lf.regression.expectOracle).toBeDefined();
        expect(lf.finding.lastTransition).toBeTruthy();
        expect(existsSync(lf.bundlePath)).toBe(true);
        const frozen = JSON.parse(readFileSync(lf.bundlePath, "utf8")) as {
          schema: string;
          finding: { id: string };
        };
        expect(frozen.schema).toBe("inspector-evidence/1");
        expect(frozen.finding.id).toBe(lf.finding.id);
      }
      for (const lf of findings.filter((f) => f.lane === "web")) {
        expect(lf.finding.adapter).toBe("web-playwright");
      }
      for (const lf of findings.filter((f) => f.lane === "android")) {
        expect(lf.finding.adapter).toBe("android-uiautomator");
      }

      // Lane gate: >=1 CONFIRMED PAGE_ERROR-class web finding. The seeded app
      // carries several hidden defects; which one exploration confirms within
      // its action budget is seed-deterministic but not pinned to #boom, so
      // the reproducibility proof below targets the defect ACTUALLY confirmed
      // (boom preferred when present).
      const webFindings = findings.filter((f) => f.lane === "web");
      expect(webFindings.length).toBeGreaterThanOrEqual(1);
      const boomWeb = webFindings.find((f) =>
        JSON.stringify(f.bundle.oracleEvidence).includes("IntentionalAppCrash"),
      );
      const webTarget = boomWeb ?? webFindings[0]!;
      const webToken =
        webTarget.bundle.oracleEvidence
          .map((s) => String(s.detail ?? ""))
          .find((d) => d.trim().length > 0) ?? "PAGE_ERROR";
      console.info(
        `[fleet] web hygiene target: ${boomWeb ? "boom-class" : "non-boom"} ` +
          `finding ${webTarget.finding.id} token="${webToken}"`,
      );

      // Both seeded android defects confirmed with evidence.
      const androidEvidence = findings
        .filter((f) => f.lane === "android")
        .map((f) => JSON.stringify(f.bundle.oracleEvidence));
      expect(androidEvidence.some((s) => s.includes("IntentionalAppCrash"))).toBe(true);
      expect(androidEvidence.some((s) => s.includes("IncrementOverflowCrash"))).toBe(true);

      // Reproducibility proofs: the stored reproducers REPLAY to the same
      // defect signature through fresh real/mock drivers.
      const hygieneEngine = new FindingEngine(OracleEngine.defaults());
      const webReplay = await hygieneEngine.reproduce(
        hygieneEngine.ingest(
          { kind: "PAGE_ERROR", detail: webToken },
          { title: "hygiene replay (web confirmed defect)" },
        ),
        webTarget.bundle.originalSteps,
        new WebReplayDriver({ artifactBaseDir: join(root, "hygiene-web") }),
        { attempts: 1, minSuccesses: 1 },
      );
      expect(webReplay.finding.status).toBe("CONFIRMED");
      expect(
        webReplay.lastSignals.some(
          (s) =>
            s.kind === "PAGE_ERROR" &&
            String(s.detail ?? "").includes(webToken),
        ),
      ).toBe(true);

      for (const token of ["IntentionalAppCrash", "IncrementOverflowCrash"]) {
        const lf = findings.find(
          (f) => f.lane === "android" && JSON.stringify(f.bundle.oracleEvidence).includes(token),
        );
        expect(lf).toBeDefined();
        const engine = new FindingEngine(OracleEngine.defaults());
        const replay = await engine.reproduce(
          engine.ingest(
            { kind: "PAGE_ERROR", detail: token },
            { title: `hygiene replay (android ${token})` },
          ),
          lf!.bundle.originalSteps,
          new AndroidReplayDriver({ artifactBaseDir: join(root, "hygiene-android") }),
          { attempts: 1, minSuccesses: 1 },
        );
        expect(replay.finding.status).toBe("CONFIRMED");
        expect(replay.lastSignals.some((s) => String(s.detail ?? "").includes(token))).toBe(
          true,
        );
      }

      // -----------------------------------------------------------------
      // RESOURCE BOUNDS (generous documented ceilings)
      // -----------------------------------------------------------------
      const rssGrowthMb = endSample.rssMb - startSample.rssMb;
      console.info(
        `[fleet] resources: rss ${startSample.rssMb.toFixed(1)}MB -> ${endSample.rssMb.toFixed(1)}MB ` +
          `(growth ${rssGrowthMb.toFixed(1)}MB), handles ${startSample.handles} -> ${endSample.handles}, ` +
          `tempRoots ${startSample.tempRoots} -> ${endSample.tempRoots}, wallMs=${wallMs}`,
      );
      expect(rssGrowthMb).toBeLessThan(250);
      expect(endSample.handles).toBeLessThanOrEqual(startSample.handles + 150);
      expect(endSample.handles).toBeLessThan(startSample.handles + Math.max(20, 0.5 * items.length));

      // -----------------------------------------------------------------
      // CLEANUP PROOF
      // -----------------------------------------------------------------
      console.info(
        `[fleet] tracked subprocesses: ${pids
          .list()
          .map((e) => `${e.pid}(${e.label})`)
          .join(", ")}`,
      );
      await pids.assertAllExited(30000); // every spawned adapter subprocess exited
      rmSync(root, { recursive: true, force: true });
      roots.pop();
      expect(countTmpRoots()).toBe(tmpBaseline); // temp dirs back to baseline

      // Wall-time ceiling for the whole suite (~8 minutes).
      expect(wallMs).toBeLessThan(480_000);

      console.info(
        `[fleet] SUMMARY effects=${effects.written.length} duplicates=0 stale=${finalState.staleCompletions} ` +
          `restarts=${finalState.restarts} killPid=${chaos.killPid} escalations=${escalations.length} ` +
          `fallbacks=${servedByMid.length} actions=${totals.actions}/${GLOBAL_MAX_ACTIONS} wallMs=${wallMs}`,
      );
    },
  );
});
