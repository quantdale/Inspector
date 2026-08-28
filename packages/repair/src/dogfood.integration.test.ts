import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { Store } from "@inspector/store-sqlite";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import type {
  Action,
  EvidenceBundle,
  Finding,
  RegressionScenario,
  ReplayDriver,
} from "@inspector/finding";
import type { OracleSignal } from "@inspector/finding";
import { OracleSuite, InvariantOracle } from "@inspector/oracle";
import { RepairEngine, ScriptedPatchAgent } from "@inspector/repair";
import { ExploreController, WebReplayDriver } from "@inspector/explore";
import type { ExploreResult } from "@inspector/explore";
import { SEED_HTML, webAdapterSpawn } from "@inspector/adapter-web";
import { ArtifactStore } from "@inspector/artifact-store";
// The dogfood proof lives in packages/repair, which does not declare a
// workspace dependency on @inspector/core. Every transitive @inspector/*
// import of run-manager.ts is aliased back to source by the integration
// config, so a direct source import keeps the REAL policy-enforcing run stack
// reachable without touching package manifests or the shared lockfile.
import { RunManager } from "../../core/src/run-manager.js";

const runGit = promisify(execFile);

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 10000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

/** Original end-to-end reproducer for the #boom crash (pre-minimization). */
const BOOM_PATH = [
  act("a", "fill", { selector: "#username", value: "admin" }),
  act("b", "fill", { selector: "#password", value: "admin" }),
  act("c", "click", { selector: "#loginBtn" }),
  act("d", "click", { selector: "#boom" }),
];

/** Benign flow that must keep working after any honest fix. */
const LOGIN_PROBE = [
  act("p1", "fill", { selector: "#username", value: "admin" }),
  act("p2", "fill", { selector: "#password", value: "admin" }),
  act("p3", "click", { selector: "#loginBtn" }),
];

/** Reproducer for the second seeded defect (counter overflow at count >= 8). */
const INCREMENT_PATH = [
  act("a", "fill", { selector: "#username", value: "admin" }),
  act("b", "fill", { selector: "#password", value: "admin" }),
  act("c", "click", { selector: "#loginBtn" }),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    act(`i${n}`, "click", { selector: "#increment" }),
  ),
];

async function makeFixtureRepo(base: string): Promise<{
  repoRoot: string;
  revision: string;
}> {
  const repoRoot = join(base, "repo");
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "app.html"), SEED_HTML);
  const g = async (...args: string[]) => runGit("git", ["-C", repoRoot, ...args]);
  await g("init");
  await g("add", ".");
  await g("-c", "user.name=fixture", "-c", "user.email=fixture@local", "commit", "-m", "seed buggy app");
  const { stdout } = await g("rev-parse", "HEAD");
  return { repoRoot, revision: stdout.trim() };
}

function verificationSuite(): OracleSuite {
  return new OracleSuite().register(
    new InvariantOracle("page-error", (r) => r.signals.some((s) => s.kind === "PAGE_ERROR")),
  );
}

/** Serves the workspace's own (possibly patched) app.html during verification. */
function driverForWorkspace(): (ws: { path: string }) => Promise<ReplayDriver> {
  return async (ws) => {
    const html = readFileSync(join(ws.path, "app.html"), "utf8");
    return new WebReplayDriver({ seedHtml: html });
  };
}

function isBoomEvidence(bundle: EvidenceBundle): boolean {
  return bundle.oracleEvidence.some(
    (s) =>
      s.kind === "PAGE_ERROR" &&
      String(s.detail ?? "").includes("IntentionalAppCrash"),
  );
}

/** Deduplicated merge of replay evidence with an ingest signal. */
function mergeWithIngest(primary: OracleSignal[], ingest: OracleSignal): OracleSignal[] {
  const key = (s: OracleSignal) => `${s.kind}|${typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail) ?? ""}`;
  const out = primary.slice();
  if (!out.some((s) => key(s) === key(ingest))) out.push(ingest);
  return out;
}

interface DogfoodState {
  explore?: ExploreResult;
  selected?: Finding;
  bundle?: EvidenceBundle;
  scenario?: RegressionScenario;
  usedFallback: boolean;
  wsA?: string;
  storeA?: Store;
  repoA?: { repoRoot: string; revision: string };
  engineA?: RepairEngine;
  badRecord?: Awaited<ReturnType<RepairEngine["repair"]>>;
  goodRecord?: Awaited<ReturnType<RepairEngine["repair"]>>;
}

const state: DogfoodState = { usedFallback: false };

describe("HARDENING_1 final dogfood: Inspector repairs its own seeded defect end-to-end", () => {
  it(
    "STEP 1 explores the seeded web app autonomously and processes discovered anomalies",
    async () => {
      const base = mkdtempSync(join(tmpdir(), "insp-dogfood-a-"));
      state.wsA = base;
      state.storeA = Store.open(join(base, "runs.db"));
      const artifacts = new ArtifactStore(join(base, "artifacts"));
      const mgr = new RunManager(state.storeA, artifacts);
      const run = await mgr.startRun(webAdapterSpawn());
      const findingEngine = new FindingEngine(OracleEngine.defaults(), state.storeA);

      const controller = new ExploreController({
        run,
        store: state.storeA,
        findingEngine,
        config: {
          seed: 7,
          maxActions: 120,
          maxWallMs: 90000,
          maxFindings: 3,
          maxResets: 30,
          reproducibleAttempts: 1,
          reproducibleMinSuccesses: 1,
          enableFaultInjection: false,
          noveltyPlateauLimit: 50,
        },
        replayDriverFactory: () =>
          new WebReplayDriver({
            artifactBaseDir: join(base, "replay"),
            // H6 minimization may spend its bounded probe budget looking for
            // a clean positive reproducer. Keep the adapter alive across
            // those probes so the dogfood gate measures the repair pipeline,
            // not repeated Chromium startup cost.
            persistent: true,
          }),
      });

      try {
        state.explore = await controller.run_();
      } finally {
        await run.close();
      }

      // The explorer worked autonomously against the real spawned adapter and
      // both discovered AND processed at least one anomaly.
      expect(state.explore.anomalies.length).toBeGreaterThanOrEqual(1);
      expect(state.explore.findingOutcomes.length).toBeGreaterThanOrEqual(1);
      expect(state.explore.findings.length).toBeGreaterThanOrEqual(1);
      expect(state.explore.evidenceBundles.length).toBe(state.explore.findings.length);
      expect(state.explore.findings.every((f) => f.status === "CONFIRMED")).toBe(true);
      // Wave-2 additions are populated and coherent with the findings.
      expect(state.explore.regressionScenarios.length).toBe(state.explore.findings.length);
      for (const o of state.explore.findingOutcomes) {
        expect(["confirmed", "confirmed-unverified-minimization", "rejected", "flaky"]).toContain(o.outcome);
      }
    },
    300000,
  );

  it(
    "STEP 2 carries a CONFIRMED PAGE_ERROR #boom finding with an intact evidence bundle",
    async () => {
      const explore = state.explore!;
      const idx = explore.evidenceBundles.findIndex(isBoomEvidence);
      if (idx >= 0) {
        state.selected = explore.findings[idx]!;
        state.bundle = explore.evidenceBundles[idx]!;
        state.scenario = explore.regressionScenarios[idx]!;
      } else {
        // Deterministic fallback sanctioned by the campaign brief: exploration
        // coverage is nondeterministic under a reduced budget, so the #boom
        // defect is confirmed through the SAME public pipeline (ingest ->
        // reproduce -> minimize -> confirm -> bundle -> regression export).
        state.usedFallback = true;
        const base = state.wsA!;
        const engine = new FindingEngine(OracleEngine.defaults(), state.storeA!);
        const signal: OracleSignal = {
          kind: "PAGE_ERROR",
          detail: "IntentionalAppCrash: boom button",
        };
        const finding = engine.ingest(signal, {
          runId: explore.runId,
          title: "boom button crashes the app",
          adapter: "web-playwright",
        });
        const driver = new WebReplayDriver({ artifactBaseDir: join(base, "replay-fallback") });
        const rep = await engine.reproduce(finding, BOOM_PATH, driver, {
          attempts: 1,
          minSuccesses: 1,
        });
        expect(rep.finding.status).toBe("CONFIRMED");
        const minimized = await engine.minimize(rep.finding, BOOM_PATH, driver);
        const confirmed =
          rep.finding.status === "MINIMIZED"
            ? engine.transition(rep.finding, "CONFIRMED", {
                reason: "minimization verified reproduction",
              })
            : rep.finding;
        state.selected = confirmed;
        state.bundle = engine.buildBundle(confirmed, BOOM_PATH, minimized, {
          signals: mergeWithIngest(rep.lastSignals, signal),
          replayCommand: `inspector replay --finding ${confirmed.id}`,
        });
        state.scenario = engine.exportRegression(confirmed, minimized, "PAGE_ERROR", {
          adapter: "web-playwright",
        });
      }

      const f = state.selected!;
      const bundle = state.bundle!;
      const scenario = state.scenario!;

      // Defect identity: PAGE_ERROR class on the #boom crash path.
      expect(f.status).toBe("CONFIRMED");
      expect(f.signature).toBe("PAGE_ERROR");
      expect(isBoomEvidence(bundle)).toBe(true);

      // Evidence bundle integrity: frozen snapshot, real oracle evidence,
      // artifact ref list present, reproducer steps preserved.
      expect(Object.isFrozen(bundle)).toBe(true);
      expect(bundle.schema).toBe("inspector-evidence/1");
      expect(bundle.oracleEvidence.length).toBeGreaterThan(0);
      expect(Array.isArray(bundle.artifactRefs)).toBe(true);
      expect(Object.isFrozen(bundle.artifactRefs)).toBe(true);
      expect(bundle.originalSteps.length).toBeGreaterThan(0);
      expect(bundle.minimizedSteps.length).toBeGreaterThan(0);
      expect(bundle.minimizedSteps.length).toBeLessThanOrEqual(bundle.originalSteps.length);
      expect(() => structuredClone(bundle)).not.toThrow();

      // Regression scenario identity: correct adapter, oracle class, steps.
      expect(scenario.schema).toBe("inspector-regression/1");
      expect(scenario.adapter).toBe("web-playwright");
      expect(scenario.expectOracle).toBe("PAGE_ERROR");
      expect(scenario.findingId).toBe(f.id);
      expect(scenario.steps.length).toBeGreaterThan(0);

      // Durable round-trip: the store holds exactly this finding state.
      const persisted = state.storeA!.getFinding(f.id);
      expect(persisted?.status).toBe("CONFIRMED");
      expect(persisted?.adapter).toBe("web-playwright");
    },
    180000,
  );

  it(
    "STEP 3a rejects a masking patch that deletes the crashing control, and falls back to CONFIRMED",
    async () => {
      state.repoA = await makeFixtureRepo(state.wsA!);
      state.engineA = new RepairEngine(new FindingEngine(OracleEngine.defaults(), state.storeA!), {
        repoRoot: state.repoA.repoRoot,
        revision: state.repoA.revision,
        evidenceDir: join(state.wsA!, "evidence"),
        maxAttempts: 2,
        driverFor: driverForWorkspace(),
        oracleSuite: verificationSuite(),
        maskingProbe: LOGIN_PROBE,
      });

      // Adversarial agent: 'fixes' the crash by removing the #boom button and
      // its handler so the reproducer can never reach the defect again.
      // Line endings are matched agnostically: git worktrees on Windows
      // (core.autocrlf=true) serve CRLF sources, exactly like this one.
      const badAgent = new ScriptedPatchAgent("button-hider", [
        {
          apply: (_path, content) => {
            if (!content.includes("IntentionalAppCrash")) return null;
            return content
              .replace(/ *<button id="boom"[^>]*>[^<]*<\/button>\r?\n/, "")
              .replace(/ *\$\("boom"\)\.addEventListener\("click", \(\) => \{[\s\S]*?\}\);\r?\n/, "");
          },
        },
      ]);

      const before = state.selected!.status;
      state.badRecord = await state.engineA.repair(
        state.selected!,
        state.bundle!.minimizedSteps,
        badAgent,
        { errorText: "IntentionalAppCrash", selectors: ["#boom"] },
      );

      expect(before).toBe("CONFIRMED");
      expect(state.badRecord.outcome).toBe("VERIFICATION_FAILED");
      expect(state.badRecord.attempts.length).toBeGreaterThanOrEqual(1);
      const rejected = state.badRecord.attempts.find((a) => a.verdict === "REJECTED");
      expect(rejected).toBeDefined();
      expect(rejected?.reason).toMatch(/masking|complet|fires/i);
      // The full masking patch is preserved for audit even though rejected.
      expect(rejected?.patch?.files[0]?.content).not.toContain("IntentionalAppCrash");
      expect(rejected?.patch?.files[0]?.content).not.toContain('id="boom"');
      // The finding falls back to CONFIRMED: still valid, still unpatched.
      expect(state.selected!.status).toBe("CONFIRMED");
      // Isolation: the primary checkout was never touched.
      const { stdout } = await runGit("git", [
        "-C",
        state.repoA.repoRoot,
        "status",
        "--porcelain",
      ]);
      expect(stdout.trim()).toBe("");
    },
    240000,
  );

  it(
    "STEP 3b accepts a valid patch with regression-first proof and durable audit",
    async () => {
      const goodAgent = new ScriptedPatchAgent("good-fixer", [
        {
          apply: (_path, content) => {
            if (!content.includes("IntentionalAppCrash")) return null;
            return content.replace(
              /throw new Error\("IntentionalAppCrash[^"]*"\);/,
              "// crash removed by repair",
            );
          },
        },
      ]);

      state.goodRecord = await state.engineA!.repair(
        state.selected!,
        state.bundle!.minimizedSteps,
        goodAgent,
        { errorText: "IntentionalAppCrash", selectors: ["#boom"] },
      );

      const record = state.goodRecord;
      expect(record.outcome).toBe("RESOLVED");
      expect(record.attempts[0]?.verdict).toBe("ACCEPTED");
      expect(record.attempts[0]?.patch?.files[0]?.content).toContain(
        "// crash removed by repair",
      );
      // Worktree identity: repair ran outside the primary checkout at a
      // concrete detached commit.
      expect(record.worktreeCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(record.workspacePath).not.toBe(state.repoA!.repoRoot);
      // Regression-first proof: a durable regression artifact exists AFTER the
      // workspace was disposed, and it encodes the minimized reproducer.
      expect(record.regressionArtifact).toBeDefined();
      expect(existsSync(record.regressionArtifact!)).toBe(true);
      const regression = JSON.parse(
        readFileSync(record.regressionArtifact!, "utf8"),
      ) as RegressionScenario;
      expect(regression.findingId).toBe(state.selected!.id);
      expect(regression.steps).toEqual(state.bundle!.minimizedSteps);
      // Lifecycle + durability: finding RESOLVED in memory and in the store,
      // full audit record persisted as JSON evidence.
      expect(state.selected!.status).toBe("RESOLVED");
      expect(state.storeA!.getFinding(state.selected!.id)?.status).toBe("RESOLVED");
      const recordPath = join(state.wsA!, "evidence", `repair-${state.selected!.id}.json`);
      expect(existsSync(recordPath)).toBe(true);
      const persistedRecord = JSON.parse(readFileSync(recordPath, "utf8")) as typeof record;
      expect(persistedRecord.outcome).toBe("RESOLVED");
      expect(persistedRecord.attempts.some((a) => a.verdict === "ACCEPTED")).toBe(true);
    },
    240000,
  );

  it(
    "STEP 4 applies the accepted patch to a fixture checkout and replays the original defect clean",
    async () => {
      const checkout = join(state.wsA!, "apply-checkout");
      await runGit("git", ["clone", state.repoA!.repoRoot, checkout]);

      const written = await state.engineA!.applyAcceptedPatch(state.goodRecord!, checkout);
      expect(written).toEqual(["app.html"]);

      const patched = readFileSync(join(checkout, "app.html"), "utf8");
      expect(patched).toContain("// crash removed by repair");
      expect(patched).not.toContain("IntentionalAppCrash");

      // Replay the canonical reproducer (the minimized scenario the repair was
      // verified against) against the patched target. The original defect is
      // gone: no oracle signal fires anywhere on the path, and the formerly
      // crashing control now answers successfully. Intermediate automation
      // misses on stale steps (e.g. clicking an element hidden by an earlier
      // login) are benign and carry no oracle signal.
      const driver = new WebReplayDriver({
        seedHtml: patched,
        artifactBaseDir: join(state.wsA!, "replay-apply"),
      });
      const result = await driver.replay(state.bundle!.minimizedSteps);
      expect(result.signals).toEqual([]);
      const boomAction = state.bundle!.minimizedSteps.at(-1)!;
      const boomIdx = result.outcomes.findIndex((o) => o.actionId === boomAction.id);
      expect(boomIdx).toBeGreaterThanOrEqual(0);
      expect(result.outcomes[boomIdx]?.status).toBe("success");

      // The ORIGINAL discovered path no longer fires THIS defect either.
      // (Unrelated seeded defects on the full path are a separate finding; the
      // IntentionalAppCrash class must not reappear.)
      const full = await driver.replay(state.bundle!.originalSteps);
      expect(
        full.signals.some(
          (s) => String(s.detail ?? "").includes("IntentionalAppCrash"),
        ),
      ).toBe(false);

      // Persisted final finding state reflects RESOLVED with an audit trail.
      const persisted = state.storeA!.getFinding(state.selected!.id)!;
      expect(persisted.status).toBe("RESOLVED");
      const lastTransition = JSON.parse(persisted.lastTransitionJson!) as {
        from: string;
        to: string;
      };
      expect(lastTransition.to).toBe("RESOLVED");
    },
    120000,
  );

  it(
    "STEP 5 runs two more independent pipelines concurrently on different seeded defects without cross-contamination",
    async () => {
      // Instance B: full find -> confirm -> minimize -> repair chain against
      // the increment-overflow seeded defect.
      const runIncrementPipeline = async () => {
        const base = mkdtempSync(join(tmpdir(), "insp-dogfood-b-"));
        const store = Store.open(join(base, "runs.db"));
        try {
          const engine = new FindingEngine(OracleEngine.defaults(), store);
          const signal: OracleSignal = {
            kind: "PAGE_ERROR",
            detail: "IncrementOverflowCrash",
          };
          const finding = engine.ingest(signal, {
            runId: "dogfood-b",
            title: "counter overflows at boundary",
            adapter: "web-playwright",
          });
          const driver = new WebReplayDriver({ artifactBaseDir: join(base, "replay") });
          const rep = await engine.reproduce(finding, INCREMENT_PATH, driver, {
            attempts: 1,
            minSuccesses: 1,
          });
          expect(rep.finding.status).toBe("CONFIRMED");
          const minimized = await engine.minimize(rep.finding, INCREMENT_PATH, driver);
          const confirmed =
            rep.finding.status === "MINIMIZED"
              ? engine.transition(rep.finding, "CONFIRMED", {
                  reason: "minimization verified reproduction",
                })
              : rep.finding;

          const repo = await makeFixtureRepo(base);
          const repairEngine = new RepairEngine(engine, {
            repoRoot: repo.repoRoot,
            revision: repo.revision,
            evidenceDir: join(base, "evidence"),
            maxAttempts: 2,
            driverFor: driverForWorkspace(),
            oracleSuite: verificationSuite(),
            maskingProbe: LOGIN_PROBE,
          });
          const fixer = new ScriptedPatchAgent("overflow-fixer", [
            {
              apply: (_path, content) => {
                if (!content.includes("IncrementOverflowCrash")) return null;
                return content.replace(
                  /if \(count >= 8\) \{\r?\n\s*\$\("count"\)\.textContent = "NaN";\r?\n\s*throw new Error\("IncrementOverflowCrash"\);\r?\n\s*\}/,
                  "if (count >= 8) {\n        // repaired: clamp at the boundary instead of corrupting state\n        count = 8;\n      }",
                );
              },
            },
          ]);
          const record = await repairEngine.repair(confirmed, minimized, fixer, {
            errorText: "IncrementOverflowCrash",
            selectors: ["#increment"],
          });
          return { id: finding.id, status: confirmed.status, record, base, store };
        } catch (err) {
          store.close();
          throw err;
        }
      };

      // Instance C: independent confirm-and-persist chain against the #boom
      // defect on its own store and workspace.
      const runBoomPipeline = async () => {
        const base = mkdtempSync(join(tmpdir(), "insp-dogfood-c-"));
        const store = Store.open(join(base, "runs.db"));
        try {
          const engine = new FindingEngine(OracleEngine.defaults(), store);
          const signal: OracleSignal = {
            kind: "PAGE_ERROR",
            detail: "IntentionalAppCrash: boom button",
          };
          const finding = engine.ingest(signal, {
            runId: "dogfood-c",
            title: "boom button crashes the app",
            adapter: "web-playwright",
          });
          const driver = new WebReplayDriver({ artifactBaseDir: join(base, "replay") });
          const rep = await engine.reproduce(finding, BOOM_PATH, driver, {
            attempts: 1,
            minSuccesses: 1,
          });
          expect(rep.finding.status).toBe("CONFIRMED");
          const bundle = engine.buildBundle(rep.finding, BOOM_PATH, BOOM_PATH, {
            signals: mergeWithIngest(rep.lastSignals, signal),
          });
          const scenario = engine.exportRegression(rep.finding, BOOM_PATH, "PAGE_ERROR", {
            adapter: "web-playwright",
          });
          return { id: finding.id, status: rep.finding.status, bundle, scenario, base, store };
        } catch (err) {
          store.close();
          throw err;
        }
      };

      const [b, c] = await Promise.all([runIncrementPipeline(), runBoomPipeline()]);

      try {
        // Both instances completed their chains while racing each other.
        expect(b.status).toBe("RESOLVED");
        expect(b.record.outcome).toBe("RESOLVED");
        expect(c.status).toBe("CONFIRMED");

        // No cross-contamination: distinct identities, disjoint stores, and
        // disjoint workspaces; neither instance can see the others' findings.
        expect(b.id).not.toBe(c.id);
        expect(b.id).not.toBe(state.selected!.id);
        expect(c.id).not.toBe(state.selected!.id);
        expect(b.base).not.toBe(c.base);
        expect(b.base).not.toBe(state.wsA);
        expect(c.base).not.toBe(state.wsA);
        expect(b.store.getFinding(c.id)).toBeUndefined();
        expect(c.store.getFinding(b.id)).toBeUndefined();
        expect(b.store.getFinding(state.selected!.id)).toBeUndefined();
        expect(c.store.getFinding(state.selected!.id)).toBeUndefined();
        // Instance C's evidence names its own defect, not instance B's.
        expect(isBoomEvidence(c.bundle)).toBe(true);
        expect(c.bundle.oracleEvidence.some((s) => String(s.detail ?? "").includes("IncrementOverflowCrash"))).toBe(false);
        // The main instance's final state is untouched by the concurrent runs.
        expect(state.storeA!.getFinding(state.selected!.id)?.status).toBe("RESOLVED");
      } finally {
        b.store.close();
        c.store.close();
      }
    },
    300000,
  );
});
