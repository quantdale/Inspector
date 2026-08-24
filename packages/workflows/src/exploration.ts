import { join } from "node:path";
import {
  PolicyEngine,
  RunManager,
  type RunController,
} from "@inspector/core";
import { EXPLORER_VERSION, loadLatestCheckpoint, configFingerprint } from "@inspector/explore";
import { openWorkspace, remapWorkspaceConflict, adapterSpawn } from "./workspace.js";
import { WorkflowError } from "./errors.js";
import {
  buildDurableHuntMeta,
  mergeResumeRequest,
  parseDurableHuntMeta,
  storedAdapterSpawn,
  validateTargetUrl,
  type CampaignProvenance,
} from "./meta.js";
import { fakeExploreConfig, huntPolicy, nativeExploreConfig, webExploreConfig } from "./configs.js";
import { closeRunGuarded, writeEvidenceBundles } from "./evidence.js";
import { runFakeHunt } from "./fake-hunt.js";
import { runNativeHuntCommand } from "./native-hunt.js";
import { runWebHunt } from "./web-hunt.js";
import type { ExplorationControl, ExplorationWorkflow, HuntRequest, HuntRunResult, ProgressFn } from "./types.js";

export type { ExplorationWorkflow, HuntRequest, HuntRunResult, ProgressFn };
export { validateTargetUrl };

export interface ExplorationOptions {
  /** Directory whose `.inspector` subtree is the workspace. */
  workspaceDir: string;
  workflow: ExplorationWorkflow;
  request: HuntRequest;
  progress?: ProgressFn;
  /** CLI-style flags map, used only for resume override compatibility checks. */
  resumeFlags?: Record<string, string | true | undefined>;
  warning?: string | null;
  /** M12: campaign provenance threaded into durable run meta. */
  campaign?: CampaignProvenance;
  /**
   * HARDENING_2 D1/D3: cooperative cancellation + pre-consumption budget
   * permission threaded into the REAL exploration loops. When present, the
   * loops stop with `stoppedReason: 'cancelled' | 'budget-exhausted'` at
   * safe boundaries; committed findings stay durable.
   */
  control?: ExplorationControl;
}

export interface ExplorationOutcome {
  code: number;
  result: HuntRunResult;
  bundlePaths: Array<{ findingId: string; path: string }>;
  badStop: boolean;
  errorOutcomes: number;
  resumed: boolean;
  /** Echoed workspace-root warning for payload embedding. */
  warning?: string | null;
}

/**
 * Service-level exploration shared by interactive CLI commands and fleet
 * executors. Opens an isolated workspace view, validates resume provenance,
 * drives the REAL exploration engines through RunManager, and writes evidence
 * bundles — exactly what `hunt`/`explore` always did, now reusable.
 *
 * Error paths throw {@link WorkflowError} with stable kinds; output shaping
 * stays with the caller.
 */
export async function runExploration(opts: ExplorationOptions): Promise<ExplorationOutcome> {
  const progress: ProgressFn = opts.progress ?? (() => {});
  let req = opts.request;
  const dir = opts.workspaceDir;
  let workspace: ReturnType<typeof openWorkspace>;
  try {
    workspace = openWorkspace(dir);
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  const { store, artifacts: _artifacts, base } = workspace;
  let run: RunController | null = null;
  let resuming = false;
  try {
    let storedRun: ReturnType<typeof store.getRun> = undefined;
    let storedCampaign: ReturnType<typeof store.getExplorationCampaign> = undefined;
    let storedSpawn: ReturnType<typeof storedAdapterSpawn> = null;
    if (req.resumeRunId) {
      resuming = true;
      const resumeRunId = req.resumeRunId;
      storedRun = store.getRun(resumeRunId);
      if (!storedRun) throw new WorkflowError("not-found", `run not found: ${resumeRunId}`);
      if (["closed", "failed", "crashed", "complete", "resolved"].includes(storedRun.status)) {
        throw new WorkflowError("terminal-run", `run ${resumeRunId} is already ${storedRun.status}; a terminal autonomous hunt cannot resume`);
      }
      const meta = parseDurableHuntMeta(storedRun.meta_json, resumeRunId);
      if (meta.workflow !== opts.workflow) {
        throw new WorkflowError(
          "incompatible-run",
          `run ${resumeRunId} was created by '${meta.workflow}', not '${opts.workflow}'; resume with the matching command`,
        );
      }
      req = mergeResumeRequest(opts.resumeFlags ?? {}, req, meta);
      if (meta.request.adapter !== req.adapter) {
        throw new WorkflowError("incompatible-run", `run ${req.resumeRunId} records adapter '${meta.request.adapter}', not '${req.adapter}'`);
      }
      storedCampaign = store.getExplorationCampaign(resumeRunId);
      if (!storedCampaign) {
        throw new WorkflowError("not-resumable", `run ${resumeRunId} has no durable exploration campaign; use 'runs resume' for environment-only reattachment`);
      }
      storedSpawn = storedAdapterSpawn(storedRun.adapter);
      if (!storedSpawn) {
        throw new WorkflowError(
          "unknown-adapter",
          `cannot determine the original adapter for run ${resumeRunId} (recorded '${storedRun.adapter ?? "unknown"}'); refusing to guess`,
        );
      }
      const explorerKind = req.adapter === "web" ? "web" : req.adapter === "fake" ? "fake" : "native";
      if (storedCampaign.explorerKind !== explorerKind || storedCampaign.adapter !== storedRun.adapter) {
        throw new WorkflowError("incompatible-run", `run ${resumeRunId} explorer/adapter provenance is inconsistent; refusing to resume`);
      }
      if (explorerKind === "web") {
        const cfg = webExploreConfig(req);
        loadLatestCheckpoint(store, {
          runId: resumeRunId,
          explorerKind: "web",
          explorerVersion: EXPLORER_VERSION,
          adapter: storedCampaign.adapter,
          seed: req.seed >>> 0,
          configFingerprint: configFingerprint(cfg),
        }, {
          maxActions: cfg.maxActions,
          maxResets: cfg.maxResets ?? 0,
          maxFindings: cfg.maxFindings ?? 0,
          maxWallMs: cfg.maxWallMs ?? 0,
        });
      } else if (explorerKind === "native") {
        const native = nativeExploreConfig(req);
        loadLatestCheckpoint(store, {
          runId: resumeRunId,
          explorerKind: "native",
          explorerVersion: EXPLORER_VERSION,
          adapter: storedCampaign.adapter,
          seed: req.seed >>> 0,
          configFingerprint: configFingerprint(native),
        }, {
          maxActions: native.maxActions,
          maxResets: 0,
          maxFindings: native.maxFindings,
          maxWallMs: native.maxWallMs,
        });
      } else {
        const fake = fakeExploreConfig(req);
        loadLatestCheckpoint(store, {
          runId: resumeRunId,
          explorerKind: "fake",
          explorerVersion: EXPLORER_VERSION,
          adapter: storedCampaign.adapter,
          seed: req.seed >>> 0,
          configFingerprint: configFingerprint(fake),
        }, {
          maxActions: fake.maxActions,
          maxResets: 0,
          maxFindings: fake.maxFindings,
          maxWallMs: fake.maxMinutes * 60_000,
        });
      }
    }
    const mgr = new RunManager(store, _artifacts, new PolicyEngine(huntPolicy(req)));
    // RC1 external targets flow through WEB_TARGET_URL: RunManager issues the
    // lifecycle create itself, and the web adapter bin reads this env var as
    // its constructor-level default target.
    const webTarget = req.adapter === "web" && req.targetUrl !== undefined;
    const isNative =
      req.adapter === "cli" || req.adapter === "windows" || req.adapter === "android";
    const spawnSpec = resuming
      ? storedSpawn!
      : webTarget
        ? adapterSpawn("web", { WEB_TARGET_URL: req.targetUrl })
        : adapterSpawn(req.adapter);
    let createOptions: Record<string, unknown> | undefined;
    let spawnEnvDelta: NodeJS.ProcessEnv | undefined;
    if (isNative) {
      if (req.adapter === "windows" && req.target !== undefined) {
        createOptions = { titleContains: req.target, timeoutMs: 30000 };
      } else if (req.adapter === "android") {
        // Default to Android Settings: an independently developed, always-
        // present target on any AVD; --target overrides.
        createOptions = { launchPackage: req.target ?? "com.android.settings" };
        spawnEnvDelta = { INSPECTOR_ANDROID_LAUNCH_PACKAGE: req.target ?? "com.android.settings" };
      } else if (req.adapter === "cli") {
        spawnEnvDelta = {
          // Real ConPTY is required for a genuine TUI exploration proof.
          INSPECTOR_PTY: "real",
          ...(req.target !== undefined ? { INSPECTOR_CLI_PROGRAM: req.target } : {}),
          INSPECTOR_CLI_CWD: join(base, "pty-cwd"),
        };
      }
    }
    try {
      if (resuming) {
        run = await mgr.resumeRun(req.resumeRunId!, {
          ...spawnSpec,
          ...(isNative ? { observeTimeoutMs: 30000 } : {}),
        });
      } else {
        const explorerKind = req.adapter === "web" ? "web" : req.adapter === "fake" ? "fake" : "native";
        const explorerConfig =
          explorerKind === "web"
            ? webExploreConfig(req)
            : explorerKind === "native"
              ? nativeExploreConfig(req)
              : fakeExploreConfig(req);
        run = await mgr.startRun({
          ...spawnSpec,
          runMeta: buildDurableHuntMeta(req, opts.workflow, opts.campaign),
          exploration: {
            schemaVersion: 1,
            explorerKind,
            explorerVersion: EXPLORER_VERSION,
            config: explorerConfig,
          },
          // Persisted so runs resume re-creates the SAME target, never the default.
          ...(webTarget ? { createOptions: { targetUrl: req.targetUrl }, spawnEnvDelta: { WEB_TARGET_URL: req.targetUrl } } : {}),
          ...(createOptions ? { createOptions } : {}),
          ...(spawnEnvDelta ? { spawnEnvDelta } : {}),
          // Real-device adapters need headroom on observe (uiautomator dumps).
          ...(isNative ? { observeTimeoutMs: 30000 } : {}),
        });
      }
    } catch (e) {
      throw remapWorkspaceConflict(e);
    }

    const result =
      req.adapter === "web"
        ? await runWebHunt(run, store, req, base, progress, resuming, opts.control)
        : isNative
          ? await runNativeHuntCommand(run, store, req, base, progress, resuming, opts.control)
           : await runFakeHunt(run, store, req, progress, resuming, opts.control);

    const bundlePaths = writeEvidenceBundles(base, result.runId, result.evidenceBundles);
    const errorOutcomes = result.findingOutcomes.filter((o) => o.outcome === "error");
    const badStop =
      result.stoppedReason === "adapter-error" ||
      result.stoppedReason === "initial-observe-failed";
    const code = badStop || errorOutcomes.length > 0 ? 1 : 0;

    return {
      code,
      result,
      bundlePaths: [...bundlePaths.entries()].map(([findingId, path]) => ({ findingId, path })),
      badStop,
      errorOutcomes: errorOutcomes.length,
      resumed: resuming,
      ...(opts.warning !== undefined ? { warning: opts.warning } : {}),
    };
  } finally {
    if (run) await closeRunGuarded(run, progress);
    store.close();
  }
}
