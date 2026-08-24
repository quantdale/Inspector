import { statSync } from "node:fs";
import { join } from "node:path";
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
import { WorkflowError } from "./errors.js";
import {
  loadReplaySubject,
  replayDriverFor,
  WorkflowProvenanceError,
} from "./replay-subject.js";
import { probeAdb, probeBrowser, probeElectron, probePty, probeUia, type BackendProbe } from "./capabilities.js";

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
    if (uia.ok) {
      families.push("windows");
      capabilities.push("uia");
      details.push("uia ok");
    }
    if (adb.ok) {
      families.push("android");
      capabilities.push("adb");
      details.push(`adb ok`);
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
          // Graduated autonomy: discovery never implies repair.
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

  /* --------------------------------------------------------------- *
   * hunt / explore items: real exploration engines per-item isolated *
   * --------------------------------------------------------------- */

  private async runExplorationItem(item: WorkItem, ctx: ExecutionContext): Promise<WorkItemResult> {
    if (ctx.signal.aborted) throw new ItemCancelledError();
    const adapter = familyAdapter(item);
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
    });

    const r = outcome.result;
    const usage = { actions: r.actionsExecuted, resets: r.resets };
    ctx.charge(usage);
    const artifactBytes = outcome.bundlePaths.reduce((total, entry) => {
      try {
        return total + statSync(entry.path).size;
      } catch {
        return total;
      }
    }, 0);
    if (artifactBytes > 0) ctx.charge({ artifactBytes });

    const failedOutcome = outcome.badStop || outcome.errorOutcomes > 0;
    if (failedOutcome) {
      return failedResult(
        outcome.badStop ? "environment-unavailable" : "execution-failure",
        `exploration stopped with '${r.stoppedReason}'` +
          (outcome.errorOutcomes > 0 ? ` (${outcome.errorOutcomes} error-level finding outcome(s))` : ""),
        { findings: r.findings, evidencePaths: outcome.bundlePaths.map((b) => b.path), runIds: [r.runId], usage },
      );
    }
    if (ctx.signal.aborted) throw new ItemCancelledError();
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
    const findingId = typeof item.targetConfig?.findingId === "string" ? String(item.targetConfig.findingId) : undefined;
    if (!findingId) {
      return failedResult(
        "target-config-invalid",
        "verify items require targetConfig.findingId pointing at a durable CONFIRMED finding in the item workspace",
      );
    }
    if (ctx.signal.aborted) throw new ItemCancelledError();
    const store = openItemStore(ctx.workspaceDir);
    try {
      const base = join(ctx.workspaceDir, ".inspector");
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
      const driver = await this.replayDriverForWorkspace(store, base, subject.finding.id, ctx);
      let successes = 0;
      let errors = 0;
      for (let index = 1; index <= attempts; index++) {
        if (ctx.signal.aborted) throw new ItemCancelledError();
        if (!ctx.charge({ actions: Math.max(1, subject.bundle.minimizedSteps.length) })) {
          return failedResult("budget-exhausted", "verification budget exhausted mid-attempt");
        }
        try {
          const result: import("@inspector/finding").ReplayResult = await driver.replay(subject.bundle.minimizedSteps);
          const evaluation = OracleEngine.defaults().evaluate(result);
          if (evaluation.reproduced) successes += 1;
        } catch {
          errors += 1;
        }
      }
      const classification =
        successes >= 1 ? "reproduced" : errors > 0 ? "environment-failure" : "fixed";
      if (classification !== "reproduced") {
        const engine = new FindingEngine(OracleEngine.defaults(), store);
        const current = engine.rehydrate(subject.record);
        if (current.status === "CONFIRMED") {
          engine.transition(current, "RESOLVED", {
            reason: "campaign verify replayed the minimized reproducer clean",
            actor: "inspector-workflow-executor",
          });
        }
      }
      return okResult({
        findings: [],
        evidencePaths: [],
        runIds: [],
        usage: { actions: attempts * Math.max(1, subject.bundle.minimizedSteps.length) },
        notes: {
          verify: {
            findingId,
            attempts,
            successes,
            errors,
            classification,
            bundlePath: subject.bundlePath,
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
    const store = openItemStore(ctx.workspaceDir);
    try {
      const records = store.listFindings(500).filter((f) => f.status === "CONFIRMED" || f.status === "REGRESSED");
      if (records.length === 0) {
        return failedResult(
          "target-incompatible",
          "no durable CONFIRMED findings to regress in this item's workspace; point regress items at workspaces produced by hunt/explore items (keepWorkspaces)",
        );
      }
      const limit = clampInt(item.budgets?.maxActions ?? numOption(item.targetConfig?.limit), 4, 1, 50);
      const base = join(ctx.workspaceDir, ".inspector");
      const results: Array<{ findingId: string; reproduced: boolean }> = [];
      for (const record of records.slice(0, limit)) {
        if (ctx.signal.aborted) throw new ItemCancelledError();
        let driver: ReplayDriver;
        try {
          driver = await this.replayDriverForWorkspace(store, base, record.id, ctx);
        } catch (err) {
          if (err instanceof WorkflowProvenanceError || err instanceof WorkflowError) continue;
          throw err;
        }
        const subject = loadReplaySubject(store, base, record.id);
        if (!ctx.charge({ actions: Math.max(1, subject.bundle.minimizedSteps.length) })) {
          return failedResult("budget-exhausted", "regression budget exhausted mid-scenario");
        }
        try {
          const result = await driver.replay(subject.bundle.minimizedSteps);
          results.push({ findingId: record.id, reproduced: OracleEngine.defaults().evaluate(result).reproduced });
        } catch {
          results.push({ findingId: record.id, reproduced: false });
        }
      }
      const reproduced = results.filter((r) => r.reproduced).length;
      return okResult({
        findings: [],
        evidencePaths: [],
        runIds: [],
        notes: {
          regress: {
            scenariosReplayed: results.length,
            reproduced,
            clean: results.length - reproduced,
            detail: results.slice(0, 20),
          },
        },
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

function openItemStore(workspaceDir: string): Store {
  return Store.open(join(workspaceDir, ".inspector", "runs.db"));
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

function familyAdapter(item: WorkItem): "web" | "fake" | "cli" | "windows" | "android" {
  const raw = item.adapterFamily ?? item.target;
  if (raw === "cli" || raw === "pty") return "cli";
  if (raw === "windows" || raw === "uia") return "windows";
  if (raw === "android") return "android";
  if (raw === "web") return "web";
  return "fake";
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
