import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { ReplayDriver } from "@inspector/finding";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { Store } from "@inspector/store-sqlite";
import type { WorkItem } from "@inspector/scale";
import {
  ItemCancelledError,
  failedResult,
  okResult,
  type ExecutionContext,
  type AdapterFamily,
  type WorkItemExecutor,
  type WorkItemResult,
  type WorkerCapabilitySnapshot,
  type WorkItemFailureClass,
} from "@inspector/scale";
import { runExploration, validateTargetUrl } from "./exploration.js";
import { familyContractFor } from "./families.js";
import { loadModelProviderModule, ProviderModuleError } from "@inspector/model-runtime";
import type { ModelProvider } from "@inspector/model-runtime";
import type { ModelAssistanceConfig } from "./model-support.js";
import { WorkflowError } from "./errors.js";
import {
  loadReplaySubject,
  replayDriverFor,
  WorkflowProvenanceError,
} from "./replay-subject.js";
import { probeAdb, probeBrowser, probeElectron, probePty, probeUia, type BackendProbe } from "./capabilities.js";
import type { ExplorationControl } from "./types.js";

/** Capability tag each adapter family requires on a worker. */
export const FAMILY_CAPABILITY: Record<Exclude<AdapterFamily, "fake">, string> = {
  web: "browser",
  cli: "pty",
  windows: "uia",
  android: "adb",
  electron: "electron",
};

export interface InspectorExecutorOptions {
  /** Campaign id recorded into durable run meta for provenance. */
  campaignId?: string;
  /**
   * Deterministic probe injection (test seam, mirroring the repository's
   * injectable-backend pattern). Keys override the corresponding live probe.
   */
  probes?: Partial<Record<"browser" | "pty" | "uia" | "adb" | "electron", BackendProbe>>;
  /**
   * M13 F15/F16/F17: optional model assistance for web-explorer items.
   * Providers may be given directly (fleet-embedded) or via a trusted local
   * module path. Budget ceilings ride the scheduler-owned ctx.modelGate so
   * global/worker/item model scopes stay atomic across concurrent workers.
   */
  model?: Omit<ModelAssistanceConfig, "providers"> & {
    providers?: ModelProvider[];
    providerModule?: string;
    /** Cache for lazily loaded provider modules. */
    loaded?: ModelProvider[];
  };
}

/**
 * M12 F3: executes REAL Inspector workflows as campaign items through the
 * same services the interactive CLI uses — per-item isolated workspace,
 * durable findings/evidence in the standard schema, honest usage accounting,
 * and cooperative cancellation. Repair stays refusal-by-default: it requires
 * an explicitly authorized item AND a configured provider (operator-supervised
 * `inspector repair` remains the repair path).
 */
export class InspectorWorkflowExecutor implements WorkItemExecutor {
  readonly id = "inspector-workflow";
  private capsPromise: Promise<WorkerCapabilitySnapshot> | null = null;

  constructor(private readonly opts: InspectorExecutorOptions = {}) {}

  /**
   * Probe real backend availability once (browser, PTY, UIA, ADB, Electron)
   * and cache the truthful snapshot. The scheduler awaits this before
   * routing, so capability decisions reflect probed reality, never guesses.
   */
  capabilities(): Promise<WorkerCapabilitySnapshot> {
    this.capsPromise ??= this.probeCapabilities();
    return this.capsPromise;
  }

  private async probeCapabilities(): Promise<WorkerCapabilitySnapshot> {
    const inject = this.opts.probes ?? {};
    const [browser, pty, uia, adb, electron] = await Promise.all([
      inject.browser ?? probeBrowser(),
      inject.pty ?? probePty(),
      inject.uia ?? probeUia(),
      inject.adb ?? probeAdb(),
      inject.electron ?? probeElectron(),
    ]);
    const families: AdapterFamily[] = ["fake"];
    const capabilities = ["deterministic-fixture", "probed"];
    const details: string[] = [];
    if (this.opts.model !== undefined) {
      // M13 F17: model capability is a distinct routing dimension — never
      // conflated with browser/pty/uia/adb/electron availability.
      capabilities.push("model-planner");
      details.push("model assistance configured");
    }
    if (browser.ok) {
      families.push("web");
      capabilities.push("browser");
      details.push("browser ok");
    } else {
      details.push(`browser unavailable (${browser.detail})`);
    }
    if (pty.ok) {
      families.push("cli");
      capabilities.push("pty");
      details.push("pty ok");
    } else {
      details.push(`pty unavailable (${pty.detail})`);
    }
    // H5-D15: configured mock backend is executable even when real probe fails.
    // Mock/injectable execution must be advertised as a distinct capability so
    // routing can succeed on hosts without the real backend while evidence
    // still distinguishes mock vs real field proof.
    const windowsMock = process.env.INSPECTOR_WINDOWS_BACKEND === "mock";
    if (uia.ok) {
      families.push("windows");
      capabilities.push("uia");
      details.push("uia ok");
      if (windowsMock) {
        capabilities.push("uia-mock");
        details.push("uia mock configured");
      }
    } else if (windowsMock) {
      families.push("windows");
      capabilities.push("uia");
      capabilities.push("uia-mock");
      details.push("uia mock (INSPECTOR_WINDOWS_BACKEND=mock) — real probe: " + uia.detail);
    } else {
      details.push(`uia unavailable (${uia.detail})`);
    }
    // Android mock is similarly configurable (CLI/PTTY mock is always deterministic-fixture).
    const androidMock = process.env.INSPECTOR_ANDROID_BACKEND === "mock";
    if (adb.ok) {
      families.push("android");
      capabilities.push("adb");
      details.push(`adb ok`);
      if (androidMock) {
        capabilities.push("adb-mock");
        details.push("adb mock configured");
      }
    } else if (androidMock) {
      families.push("android");
      capabilities.push("adb");
      capabilities.push("adb-mock");
      details.push("adb mock (INSPECTOR_ANDROID_BACKEND=mock) — real probe: " + adb.detail);
    } else {
      details.push(`adb unavailable (${adb.detail})`);
    }
    if (electron.ok) {
      families.push("electron");
      capabilities.push("electron");
      details.push("electron ok");
    }
    if (process.platform === "win32" || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY) {
      capabilities.push("display");
    }
    return {
      executorId: this.id,
      families,
      capabilities,
      available: true,
      detail: details.join("; "),
    };
  }

  /** Back-compat alias used by tests. */
  refreshCapabilities(): Promise<WorkerCapabilitySnapshot> {
    return this.capabilities();
  }

  async execute(rawItem: unknown, ctx: ExecutionContext): Promise<WorkItemResult> {
    const item = rawItem as WorkItem;
    try {
      switch (item.mode) {
        case "hunt":
        case "explore":
          return await this.runExplorationItem(item, ctx);
        case "verify":
          return await this.runVerifyItem(item, ctx);
        case "regress":
        case "regression":
          return await this.runRegressItem(item, ctx);
        case "repair":
          // Graduated autonomy: discovery never implies repair. Campaign
          // repair stays unsupported — operator-supervised
          // `inspector repair <findingId>` with explicit provider
          // configuration is THE repair path (HARDENING_2 D11; manifests
          // reject repair items at preflight).
          return failedResult(
            "policy-refusal",
            "campaign items cannot run repair; use operator-supervised `inspector repair <findingId>` with explicit authorization",
          );
        default:
          return failedResult("target-config-invalid", `unsupported workflow '${String(item.mode)}'`);
      }
    } catch (err) {
      if (err instanceof ItemCancelledError) throw err;
      if (err instanceof WorkflowError) {
        return failedResult(classifyWorkflowError(err.kind), err.message);
      }
      return failedResult(
        "execution-failure",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * HARDENING_2 D1/D3: the scheduler-owned execution context becomes the
   * exploration loops' control hook. Permission comes from ctx.admit BEFORE
   * each budgeted unit; consumption is recorded through ctx.charge as it
   * happens; cooperative stop rides the scheduler-managed abort signal.
   */
  private controlFrom(ctx: ExecutionContext): ExplorationControl {
    return {
      stopRequested: () => ctx.signal.aborted,
      admit: (kind) =>
        ctx.admit(kind === "reset" ? { resets: 1 } : { actions: 1 }),
      commit: (kind) =>
        ctx.charge(kind === "reset" ? { resets: 1 } : { actions: 1 }),
    };
  }

  /* --------------------------------------------------------------- *
   * hunt / explore items: real exploration engines per-item isolated *
   * --------------------------------------------------------------- */

  /**
   * M13 F16: model calls made inside a campaign item reserve/settle through
   * the SCHEDULER-owned gate bound to this execution context; attribution
   * carries campaign/item/worker into every durable model_calls row.
   */
  private async modelConfigFor(
    item: WorkItem,
    ctx: ExecutionContext,
  ): Promise<{ model?: NonNullable<Parameters<typeof runExploration>[0]["model"]> }> {
    const cfg = this.opts.model;
    if (cfg === undefined) return {};
    // The semantic planner/oracle ride the web explorer (ExploreController
    // seam). Deterministic fake/native explorers stay model-free by design.
    if (familyAdapter(item) !== "web") return {};
    let providers = cfg.providers;
    if (providers === undefined && cfg.providerModule !== undefined) {
      cfg.loaded ??= await this.loadProviderModule(cfg.providerModule);
      providers = cfg.loaded;
    }
    if (providers === undefined || providers.length === 0) return {};
    return {
      model: {
        providers,
        planner: cfg.planner,
        semanticOracle: cfg.semanticOracle,
        summarize: cfg.summarize,
        timeoutMs: cfg.timeoutMs,
        maxCallsPerRun: cfg.maxCallsPerRun,
        gate: ctx.modelGate,
        attribution: {
          campaignId: this.opts.campaignId ?? "unknown-campaign",
          itemId: item.id,
          workerId: ctx.workerId,
        },
      },
    };
  }

  private async loadProviderModule(modulePath: string): Promise<ModelProvider[]> {
    try {
      return await loadModelProviderModule(modulePath, { redact: (text) => text.replace(/(sk-|ghp_|xoxb-)[A-Za-z0-9_-]+/g, "***") });
    } catch (err) {
      if (err instanceof ProviderModuleError && err.classification === "invalid-provider") {
        throw new WorkflowError("provider-required", err.message);
      }
      throw err;
    }
  }

  private async runExplorationItem(item: WorkItem, ctx: ExecutionContext): Promise<WorkItemResult> {
    if (ctx.signal.aborted) throw new ItemCancelledError();
    const rawFamily = String(item.adapterFamily ?? item.target ?? "");
    // HARDENING_5 H5-D0: family resolution is exhaustive and fail-closed.
    // An accepted-but-unexecutable family is a typed configuration refusal
    // BEFORE any workspace/run side effect — never a fake substitution.
    const adapter = familyAdapter(item);
    if (adapter === undefined) {
      return failedResult(
        "target-config-invalid",
        `work item '${item.id}' requests adapter family '${rawFamily}' which has no executable workflow mapping; refusing to substitute another adapter`,
      );
    }
    if (adapter === "electron") {
      // H5.2 documented product limit: only the bundled seeded fixture is a
      // supported Electron target today; external app targeting must not ride
      // web's targetUrl/target channels accidentally.
      const externalTarget =
        item.targetUri !== undefined ||
        (typeof item.targetConfig?.targetUrl === "string" && item.targetConfig.targetUrl.length > 0) ||
        (typeof item.targetConfig?.target === "string" && item.targetConfig.target.length > 0);
      if (externalTarget) {
        return failedResult(
          "target-config-invalid",
          "electron campaign items currently support only the bundled seeded fixture; external Electron app targeting is not yet a supported contract",
        );
      }
    }
    const targetUri =
      item.targetUri ??
      (typeof item.targetConfig?.targetUrl === "string" ? String(item.targetConfig.targetUrl) : undefined);
    // Only web targets are URLs; native families carry plain descriptors
    // (UIA title substring, android launch package, CLI program name).
    const targetHint =
      typeof item.targetConfig?.target === "string"
        ? String(item.targetConfig.target)
        : adapter !== "web" && typeof item.targetUri === "string"
          ? item.targetUri
          : undefined;
    let request;
    try {
      request = {
        adapter,
        targetUrl: adapter === "web" && targetUri !== undefined ? validateTargetUrl(targetUri) : undefined,
        target: targetHint,
        seed: item.seed,
        maxActions: clampInt(item.budgets?.maxActions, 120, 1, 10_000),
        maxMinutes: clampWallMinutes(item.budgets?.maxWallMs, 10),
        maxFindings: clampInt(numOption(item.targetConfig?.maxFindings), 4, 0, 100),
      };
    } catch (err) {
      if (err instanceof WorkflowError && err.kind === "invalid-value") {
        return failedResult("target-config-invalid", err.message);
      }
      throw err;
    }

    const outcome = await runExploration({
      workspaceDir: ctx.workspaceDir,
      workflow: item.mode === "explore" ? "explore" : "hunt",
      request,
      progress: (line) => ctx.progress(line),
      campaign: {
        campaignId: this.opts.campaignId ?? "unknown-campaign",
        itemId: item.id,
        workerId: ctx.workerId,
      },
      control: this.controlFrom(ctx),
      ...(await this.modelConfigFor(item, ctx)),
    });

    const r = outcome.result;
    const usage = { actions: r.actionsExecuted, resets: r.resets };
    // HARDENING_2 D1/D2: action/reset usage was already permitted and
    // committed incrementally INSIDE the loops (pre-consumption). Only
    // artifact bytes — outputs, not permissions — are charged post-hoc.
    const artifactBytes = outcome.bundlePaths.reduce((total, entry) => {
      try {
        return total + statSync(entry.path).size;
      } catch {
        return total;
      }
    }, 0);
    if (artifactBytes > 0) ctx.charge({ artifactBytes });

    // Cooperative cancellation is never a failure: throw so the scheduler
    // reconciles the claim against durable lease truth (requeue when owned).
    if (r.stoppedReason === "cancelled" || ctx.signal.aborted) {
      throw new ItemCancelledError(`item ${item.id} stopped cooperatively`);
    }
    // Budget exhaustion is a structured durable terminal result that still
    // preserves everything the exploration actually committed.
    if (r.stoppedReason === "budget-exhausted") {
      return failedResult(
        "budget-exhausted",
        `exploration budget exhausted after ${r.actionsExecuted} action(s)/${r.resets} reset(s)`,
        {
          findings: r.findings,
          evidencePaths: outcome.bundlePaths.map((b) => b.path),
          runIds: [r.runId],
          usage,
        },
      );
    }
    if (outcome.badStop || outcome.errorOutcomes > 0) {
      return failedResult(
        outcome.badStop ? "environment-unavailable" : "execution-failure",
        `exploration stopped with '${r.stoppedReason}'` +
          (outcome.errorOutcomes > 0 ? ` (${outcome.errorOutcomes} error-level finding outcome(s))` : ""),
        { findings: r.findings, evidencePaths: outcome.bundlePaths.map((b) => b.path), runIds: [r.runId], usage },
      );
    }
    // Completed work counts even when a stop raced it: the exploration really
    // ran, and resume must never repeat it.
    return okResult({
      findings: r.findings,
      evidencePaths: outcome.bundlePaths.map((b) => b.path),
      runIds: [r.runId],
      usage,
      notes: {
        workflow: item.mode,
        adapter: request.adapter,
        statesVisited: r.statesVisited,
        stoppedReason: r.stoppedReason,
      },
    });
  }

  /* --------------------------------------------------------------- *
   * verify item: bounded honest re-verification of one durable finding *
   * --------------------------------------------------------------- */

  private async runVerifyItem(item: WorkItem, ctx: ExecutionContext): Promise<WorkItemResult> {
    let findingId = typeof item.targetConfig?.findingId === "string" ? String(item.targetConfig.findingId) : undefined;
    const sourceRef = typeof item.targetConfig?.sourceItemId === "string" ? String(item.targetConfig.sourceItemId) : undefined;
    if (!findingId && !sourceRef) {
      return failedResult(
        "target-config-invalid",
        "verify items require targetConfig.findingId or targetConfig.sourceItemId pointing at a durable CONFIRMED finding",
      );
    }
    if (ctx.signal.aborted) throw new ItemCancelledError();
    const source = resolveSourceContext(item, ctx);
    if (!source.ok) return source.result;
    const store = Store.open(source.storePath);
    try {
      const base = source.base;
      // HARDENING_2 D10: with a source reference and no explicit findingId,
      // deterministically select THE single confirmed finding the producer
      // committed; ambiguity is a configuration error, never a guess.
      if (!findingId) {
        const confirmed = store.listFindings(500).filter((f) => f.status === "CONFIRMED");
        if (confirmed.length === 1) {
          findingId = confirmed[0]!.id;
          ctx.progress(`verify selected finding ${findingId} from source '${sourceRef}'`);
        } else {
          return failedResult(
            "target-config-invalid",
            `source item '${sourceRef}' has ${confirmed.length} CONFIRMED findings; specify targetConfig.findingId explicitly`,
          );
        }
      }
      let subject;
      try {
        subject = loadReplaySubject(store, base, findingId);
      } catch (err) {
        if (err instanceof WorkflowProvenanceError) {
          return failedResult(
            err.classification === "incompatible-target" ? "target-incompatible" : "target-config-invalid",
            err.message,
          );
        }
        if (err instanceof WorkflowError && err.kind === "not-found") {
          return failedResult("target-incompatible", err.message);
        }
        throw err;
      }
      if (!["CONFIRMED", "RESOLVED", "REGRESSED"].includes(subject.finding.status)) {
        return failedResult(
          "policy-refusal",
          `finding status ${subject.finding.status} is not verification-capable`,
        );
      }
      const attempts = clampInt(numOption(item.targetConfig?.attempts), 2, 1, 8);
      const unitSteps = Math.max(1, subject.bundle.minimizedSteps.length);
      const driver = await this.replayDriverForWorkspace(store, base, subject.finding.id, ctx);
      let reproducedCount = 0;
      let errorCount = 0;
      let cleanCount = 0;
      for (let index = 1; index <= attempts; index++) {
        if (ctx.signal.aborted) throw new ItemCancelledError();
        // H5-D10: admit BEFORE consuming the replay unit. A denied admission
        // invokes no replay driver (no fabricated work, no budget charge).
        if (!ctx.admit({ actions: unitSteps })) {
          return failedResult("budget-exhausted", "verification replay not admitted by budget gate");
        }
        try {
          const result: import("@inspector/finding").ReplayResult = await driver.replay(subject.bundle.minimizedSteps);
          const evaluation = OracleEngine.defaults().evaluate(result);
          if (evaluation.reproduced) reproducedCount += 1;
          else cleanCount += 1; // executed cleanly and did not reproduce
        } catch {
          errorCount += 1; // adapter/environment failure: NOT clean evidence
        } finally {
          ctx.charge({ actions: unitSteps });
        }
      }
      // H5-D7 positive-evidence rule: a CONFIRMED finding transitions to
      // RESOLVED only when verification produced sufficient successful,
      // environment-valid, clean replay evidence. Any environment/adapter/
      // provenance failure leaves it unresolved and returns a typed
      // indeterminate result (never "fixed").
      let classification: "reproduced" | "fixed" | "environment-failure";
      if (reproducedCount >= 1) classification = "reproduced";
      else if (errorCount > 0) classification = "environment-failure";
      else classification = "fixed";
      const engine = new FindingEngine(OracleEngine.defaults(), store);
      const current = engine.rehydrate(subject.record);
      if (classification === "fixed" && current.status === "CONFIRMED") {
        engine.transition(current, "RESOLVED", {
          reason: "campaign verify replayed the minimized reproducer clean across all attempts",
          actor: "inspector-workflow-executor",
        });
      }
      if (classification === "environment-failure") {
        return failedResult(
          "environment-unavailable",
          `verify obtained no valid replay evidence in ${attempts} attempt(s) (${errorCount} errored); finding '${findingId}' remains ${current.status}`,
          {
            findings: [],
            evidencePaths: [],
            runIds: [],
            usage: { actions: attempts * unitSteps },
            notes: {
              verify: {
                findingId,
                attempts,
                reproducedCount,
                errorCount,
                cleanCount,
                classification,
                bundlePath: subject.bundlePath,
                ...(source.sourceItemId ? { sourceItemId: source.sourceItemId } : {}),
              },
            },
          },
        );
      }
      return okResult({
        findings: [],
        evidencePaths: [],
        runIds: [],
        usage: { actions: attempts * unitSteps },
        notes: {
          verify: {
            findingId,
            attempts,
            reproducedCount,
            errorCount,
            cleanCount,
            classification,
            bundlePath: subject.bundlePath,
            ...(source.sourceItemId ? { sourceItemId: source.sourceItemId } : {}),
          },
        },
      });
    } finally {
      store.close();
    }
  }

  /* --------------------------------------------------------------- *
   * regress item: bounded replay of durable confirmed findings       *
   * --------------------------------------------------------------- */

  private async runRegressItem(item: WorkItem, ctx: ExecutionContext): Promise<WorkItemResult> {
    if (ctx.signal.aborted) throw new ItemCancelledError();
    const source = resolveSourceContext(item, ctx);
    if (!source.ok) return source.result;
    const store = Store.open(source.storePath);
    try {
      const records = store.listFindings(500).filter((f) => f.status === "CONFIRMED" || f.status === "REGRESSED");
      if (records.length === 0) {
        return failedResult(
          "target-incompatible",
          "no durable CONFIRMED findings to regress in the resolved source workspace; point regress items at hunt/explore items via targetConfig.sourceItemId (keepWorkspaces)",
        );
      }
      const limit = clampInt(item.budgets?.maxActions ?? numOption(item.targetConfig?.limit), 4, 1, 50);
      const base = source.base;
      const results: Array<{ findingId: string; reproduced: boolean; error: boolean }> = [];
      let chargedActions = 0;
      for (const record of records.slice(0, limit)) {
        if (ctx.signal.aborted) throw new ItemCancelledError();
        let driver: ReplayDriver;
        try {
          driver = await this.replayDriverForWorkspace(store, base, record.id, ctx);
        } catch (err) {
          // Incompatible/missing provenance is not a clean scenario: record it
          // as an error so it can never be counted clean (H5-D8).
          if (err instanceof WorkflowProvenanceError || err instanceof WorkflowError) {
            results.push({ findingId: record.id, reproduced: false, error: true });
            continue;
          }
          throw err;
        }
        const subject = loadReplaySubject(store, base, record.id);
        const steps = Math.max(1, subject.bundle.minimizedSteps.length);
        // H5-D10: admit BEFORE consuming the replay unit.
        if (!ctx.admit({ actions: steps })) {
          return failedResult("budget-exhausted", "regression replay not admitted by budget gate");
        }
        let reproducedThis = false;
        let errorThis = false;
        try {
          const result = await driver.replay(subject.bundle.minimizedSteps);
          reproducedThis = OracleEngine.defaults().evaluate(result).reproduced;
        } catch {
          errorThis = true; // adapter/environment failure: NOT clean evidence
        } finally {
          ctx.charge({ actions: steps });
          chargedActions += steps;
        }
        results.push({ findingId: record.id, reproduced: reproducedThis, error: errorThis });
      }
      const reproduced = results.filter((r) => r.reproduced && !r.error).length;
      const errors = results.filter((r) => r.error).length;
      const clean = results.filter((r) => !r.reproduced && !r.error).length;
      const executed = reproduced + clean;
      const summary = {
        scenariosReplayed: results.length,
        executed,
        reproduced,
        clean,
        errors,
        ...(source.sourceItemId ? { sourceItemId: source.sourceItemId } : {}),
        detail: results.slice(0, 20),
      };
      // H5-D8: clean regression requires a successfully executed replay whose
      // oracle is clean. Zero valid scenarios is an indeterminate result, not
      // an OK-clean success.
      if (executed === 0) {
        return failedResult(
          "environment-unavailable",
          `regression executed zero valid scenarios (${errors} errored/incompatible of ${results.length}); cannot certify clean`,
          { findings: [], evidencePaths: [], runIds: [], usage: { actions: chargedActions }, notes: { regress: summary } },
        );
      }
      return okResult({
        findings: [],
        evidencePaths: [],
        runIds: [],
        usage: { actions: chargedActions },
        notes: { regress: summary },
      });
    } finally {
      store.close();
    }
  }

  private async replayDriverForWorkspace(
    store: Store,
    base: string,
    findingId: string,
    _ctx: ExecutionContext,
  ): Promise<ReturnType<typeof replayDriverFor>> {
    const subject = loadReplaySubject(store, base, findingId);
    _ctx.progress(`replay driver resolving for ${findingId} (${subject.run.adapter})`);
    return replayDriverFor(subject, base);
  }
}

/**
 * HARDENING_2 D10: resolve the durable source workspace a verify/regress
 * item operates on. Each campaign attempt gets a FRESH workspace, so without
 * an explicit reference a verify/regress item can never see the finding its
 * producer committed. `targetConfig.sourceItemId` names a sibling item whose
 * retained attempt workspaces live under the campaign artifacts root — path
 * containment is structural (sanitize + artifacts-root prefix check), and the
 * newest attempt with a durable store wins deterministically.
 */
function resolveSourceContext(
  item: WorkItem,
  ctx: ExecutionContext,
): { ok: true; base: string; storePath: string; sourceItemId?: string } | { ok: false; result: WorkItemResult } {
  const raw = item.targetConfig?.sourceItemId;
  if (typeof raw !== "string" || raw.length === 0) {
    const base = join(ctx.workspaceDir, ".inspector");
    return { ok: true, base, storePath: join(base, "runs.db") };
  }
  const sanitized = raw.replace(/[^A-Za-z0-9._-]+/g, "__");
  const root = resolve(join(ctx.artifactsDir, "items", sanitized));
  if (!root.startsWith(resolve(ctx.artifactsDir) + sep)) {
    return {
      ok: false,
      result: failedResult(
        "target-config-invalid",
        `sourceItemId '${raw}' resolves outside the campaign artifacts root`,
      ),
    };
  }
  if (!existsSync(root)) {
    return {
      ok: false,
      result: failedResult(
        "target-incompatible",
        `source item '${raw}' has no retained workspace; set manifest keepWorkspaces: true so downstream items can reference it`,
      ),
    };
  }
  const attempts = readdirSync(root)
    .filter((entry) => /^\d+$/.test(entry))
    .sort((a, b) => Number(b) - Number(a));
  for (const attempt of attempts) {
    const dir = join(root, attempt);
    const storePath = join(dir, ".inspector", "runs.db");
    if (existsSync(storePath)) {
      ctx.progress(`source context resolved: item '${raw}' attempt ${attempt}`);
      return { ok: true, base: join(dir, ".inspector"), storePath, sourceItemId: raw };
    }
  }
  return {
    ok: false,
    result: failedResult(
      "target-incompatible",
      `source item '${raw}' has no attempt workspace containing a durable .inspector/runs.db`,
    ),
  };
}

function numOption(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInt(raw: number | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !Number.isSafeInteger(raw) || raw < min) return fallback;
  return Math.min(raw, max);
}

function clampWallMinutes(maxWallMs: number | undefined, fallbackMinutes: number): number {
  if (maxWallMs === undefined || !Number.isFinite(maxWallMs) || maxWallMs <= 0) return fallbackMinutes;
  return Math.max(1, Math.ceil(maxWallMs / 60_000));
}

/**
 * HARDENING_5 H5-D0/H5.5: exhaustive, contract-driven family resolution.
 * Returns undefined for unknown values — callers must fail closed with a
 * typed refusal BEFORE any workspace/run side effect. Fake is selected ONLY
 * for an explicit fake-family request; there is no default fallthrough.
 */
export function familyAdapter(item: WorkItem): "web" | "fake" | "cli" | "windows" | "android" | "electron" | undefined {
  const raw = String(item.adapterFamily ?? item.target ?? "");
  return familyContractFor(raw)?.binName;
}

/** Map stable workflow error kinds into the M12 failure taxonomy. */
export function classifyWorkflowError(kind: string): WorkItemFailureClass {
  const map: Partial<Record<string, WorkItemFailureClass>> = {
    "invalid-provenance": "target-incompatible",
    "incompatible-target": "target-incompatible",
    "incompatible-run": "target-incompatible",
    "terminal-run": "target-incompatible",
    "not-resumable": "target-incompatible",
    "not-found": "target-incompatible",
    "unknown-adapter": "environment-unavailable",
    "workspace-conflict": "environment-unavailable",
    "invalid-value": "target-config-invalid",
    "missing-value": "target-config-invalid",
    "policy-refusal": "policy-refusal",
    "provider-required": "policy-refusal",
  };
  return map[kind] ?? "execution-failure";
}
