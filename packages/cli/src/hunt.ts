import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RunManager,
  PolicyEngine,
  DEFAULT_POLICY,
  type Policy,
  type RunController,
} from "@inspector/core";
import { newId, type Action, type ActionOutcome } from "@inspector/protocol";
import type { Store } from "@inspector/store-sqlite";
import {
  FindingEngine,
  OracleEngine,
  FakeStateMachineDriver,
  type Finding,
  type EvidenceBundle,
  type OracleSignal,
  type OracleSignalKind,
} from "@inspector/finding";
import { ExploreController, WebReplayDriver, runNativeHunt, type NativeSessionDeps, mulberry32 } from "@inspector/explore";
import type { ParsedInvocation } from "./args.js";
import { CliError, intFlag } from "./args.js";
import { adapterSpawn, isRepoRoot, openWorkspace, REPO_ROOT_WARNING, remapWorkspaceConflict } from "./workspace.js";

/** Progress sink; stderr so stdout stays parseable. */
export type ProgressFn = (line: string) => void;

export interface HuntRequest {
  adapter: "web" | "fake" | "cli" | "windows" | "android";
  targetUrl?: string;
  /** Native target hint: UIA title substring, android launchPackage, or CLI
   * program name — interpreted per adapter (SPEC-009 W4). */
  target?: string;
  seed: number;
  maxActions: number;
  maxMinutes: number;
  maxFindings: number;
}

export interface HuntOutcomeEntry {
  classKey: string;
  outcome: string;
  detail?: string;
  findingId?: string;
}

/** Shape shared by the web (ExploreController) and fake (walker) hunts. */
export interface HuntRunResult {
  runId: string;
  seed: number;
  stoppedReason: string;
  actionsExecuted: number;
  statesVisited: number;
  resets: number;
  anomalyCount: number;
  findings: Finding[];
  evidenceBundles: EvidenceBundle[];
  findingOutcomes: HuntOutcomeEntry[];
  warnings: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ORACLE_SIGNAL_KINDS: readonly string[] = [
  "TARGET_FAILURE",
  "PAGE_ERROR",
  "DEFECT_SUBMIT_INVALID",
  "IMPOSSIBLE_STATE",
  "ADAPTER_CRASH",
];

/** Parse and validate hunt flags into a HuntRequest. */
export function parseHuntRequest(parsed: ParsedInvocation): HuntRequest {
  const adapterRaw = parsed.flags["--adapter"];
  const adapter = adapterRaw === undefined ? "web" : adapterRaw;
  if (
    adapter !== "web" &&
    adapter !== "fake" &&
    adapter !== "cli" &&
    adapter !== "windows" &&
    adapter !== "android"
  ) {
    throw new CliError(
      "invalid-value",
      `--adapter expects 'web' | 'fake' | 'cli' | 'windows' | 'android', got '${adapter}'`,
    );
  }
  const urlRaw = parsed.flags["--url"];
  if (urlRaw !== undefined && adapter !== "web") {
    throw new CliError("invalid-value", "--url is only valid with --adapter web");
  }
  const targetRaw = parsed.flags["--target"];
  if (targetRaw !== undefined && adapter === "web") {
    throw new CliError("invalid-value", "--target is not valid with --adapter web (use --url)");
  }
  return {
    adapter,
    targetUrl:
      urlRaw === undefined || typeof urlRaw !== "string"
        ? undefined
        : validateTargetUrl(urlRaw),
    target: typeof targetRaw === "string" ? targetRaw : undefined,
    seed: intFlag(parsed.flags, "--seed", 7),
    maxActions: intFlag(parsed.flags, "--max-actions", 200),
    maxMinutes: intFlag(parsed.flags, "--max-minutes", 10),
    maxFindings: intFlag(parsed.flags, "--max-findings", 4),
  };
}

/** Mirror the adapter's RC1 policy: http(s) on localhost/127.0.0.1 only. */
export function validateTargetUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CliError("invalid-value", `--url is not a valid URL: '${raw}'`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new CliError("invalid-value", `--url must be http or https, got '${u.protocol}'`);
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw new CliError(
      "invalid-value",
      `--url must be a localhost origin for RC1 hunts, got hostname '${u.hostname}'`,
    );
  }
  return u.toString();
}

/**
 * The hunt policy must never starve its own exploration budget: budgets are
 * raised to cover the requested action/wall budgets (a policy rejection would
 * otherwise silently refuse every action).
 */
function huntPolicy(req: HuntRequest): Policy {
  const base = DEFAULT_POLICY;
  return {
    ...base,
    budgets: {
      ...base.budgets,
      max_actions: Math.max(base.budgets.max_actions, req.maxActions + 50),
      wall_clock_minutes: Math.max(base.budgets.wall_clock_minutes, req.maxMinutes + 2),
      max_environment_resets: Math.max(base.budgets.max_environment_resets, 60),
    },
  };
}

/** Write evidence bundles to <base>/bundles/<runId>/<findingId>.json. */
export function writeEvidenceBundles(
  base: string,
  runId: string,
  bundles: EvidenceBundle[],
): Map<string, string> {
  const dir = join(base, "bundles", runId);
  mkdirSync(dir, { recursive: true });
  const paths = new Map<string, string>();
  for (const bundle of bundles) {
    const path = join(dir, `${bundle.finding.id}.json`);
    writeFileSync(path, JSON.stringify(bundle, null, 2));
    paths.set(bundle.finding.id, path);
  }
  return paths;
}

/** Await run.close(), giving up (honestly) after 15s instead of hanging. */
export async function closeRunGuarded(run: RunController, warn: ProgressFn): Promise<void> {
  const CLOSE_BUDGET_MS = 15000;
  let finished = false;
  await Promise.race([
    run.close().then(() => {
      finished = true;
    }),
    sleep(CLOSE_BUDGET_MS),
  ]);
  if (!finished) {
    warn(
      `teardown: run.close() exceeded ${CLOSE_BUDGET_MS / 1000}s; continuing teardown ` +
        "(the adapter subprocess may need manual cleanup)",
    );
  }
}

/** Merge replay evidence with the ingest signal, deduplicating exact repeats. */
function mergeSignals(primary: OracleSignal[], extra: OracleSignal[]): OracleSignal[] {
  const key = (s: OracleSignal) =>
    `${s.kind}|${typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail) ?? ""}`;
  const out = primary.slice();
  for (const s of extra) {
    if (!out.some((o) => key(o) === key(s))) out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Web hunt: proven ExploreController wiring against the real adapter. *
 * ------------------------------------------------------------------ */

async function runWebHunt(
  run: RunController,
  store: Store,
  req: HuntRequest,
  base: string,
  progress: ProgressFn,
): Promise<HuntRunResult> {
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);

  // Live progress instrumentation: one line per ~25 actions and per candidate
  // defect. Retained intentionally; it changes no behavior.
  let actions = 0;
  const originalSubmit = run.submitAction.bind(run);
  run.submitAction = async (action: Action) => {
    const result = await originalSubmit(action);
    actions += 1;
    if (actions % 25 === 0) progress(`... ${actions} actions executed`);
    return result;
  };
  const originalIngest = findingEngine.ingest.bind(findingEngine);
  findingEngine.ingest = (
    signal: OracleSignal,
    opts: Parameters<FindingEngine["ingest"]>[1],
  ) => {
    progress(`candidate defect detected (${signal.kind})`);
    return originalIngest(signal, opts);
  };

  const controller = new ExploreController({
    run,
    store,
    findingEngine,
    config: {
      seed: req.seed,
      maxActions: req.maxActions,
      maxWallMs: req.maxMinutes * 60_000,
      maxFindings: req.maxFindings,
      // Proven campaign defaults: without reset budget a single lost
      // environment would end an otherwise healthy hunt.
      maxResets: 40,
      noveltyPlateauLimit: 50,
      reproducibleAttempts: 2,
      reproducibleMinSuccesses: 1,
      enableFaultInjection: false,
      observeFields: ["url", "title", "uiTree", "storage", "pageErrors", "screenshot"],
      // Reproduction must hit the same external app the anomaly came from;
      // otherwise real-target findings replay against the seeded app and
      // honestly come out REJECTED/FLAKY.
      targetUrl: req.targetUrl,
    },
    replayDriverFactory: () =>
      new WebReplayDriver({ artifactBaseDir: join(base, "replay"), targetUrl: req.targetUrl }),
  });

  const result = await controller.run_();
  return {
    runId: result.runId,
    seed: result.seed,
    stoppedReason: result.stoppedReason,
    actionsExecuted: result.actionsExecuted,
    statesVisited: result.statesVisited,
    resets: result.resets,
    anomalyCount: result.anomalies.length,
    findings: result.findings,
    evidenceBundles: result.evidenceBundles,
    findingOutcomes: result.findingOutcomes.map((o) => ({
      classKey: o.classKey,
      outcome: o.outcome,
      ...(o.detail !== undefined ? { detail: o.detail } : {}),
      ...(o.findingId !== undefined ? { findingId: o.findingId } : {}),
    })),
    warnings: result.warnings,
  };
}

/**
 * SPEC-009 W4: native (non-web) hunts share the fake walker's proven loop
 * shape but drive ANY adapter through its DECLARED vocabulary via
 * runNativeHunt. Without a platform-faithful replay driver (web/seeded-mock
 * only today), native findings stay CANDIDATE — recorded, never confirmed.
 */
async function runNativeHuntCommand(
  run: RunController,
  store: Store,
  req: HuntRequest,
  base: string,
  progress: ProgressFn,
): Promise<HuntRunResult> {
  void base;
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);

  // SPEC-009 W6: platform-faithful replay. Android findings discovered on a
  // real device are reproduced against a REAL adb backend bound to the SAME
  // package (force-stop reset; never pm clear, never mock).
  let replayDriverFactory: NativeSessionDeps["replayDriverFactory"];
  if (req.adapter === "android") {
    const { AndroidReplayDriver } = await import("../../android/src/replay.js");
    const launchPackage = req.target ?? "com.android.settings";
    const createOptions = { launchPackage };
    replayDriverFactory = () =>
      new AndroidReplayDriver({
        backend: "real",
        createOptions,
        launchPackage,
        resetStrategy: "force-stop",
      });
  } else if (req.adapter === "windows") {
    const { WindowsUiaReplayDriver } = await import("../../windows-adapter/src/replay.js");
    const targetTitle = req.target;
    replayDriverFactory = () => new WindowsUiaReplayDriver({ targetTitle });
  }

  const result = await runNativeHunt(
    { run, findingEngine, ...(replayDriverFactory ? { replayDriverFactory } : {}) },
    {
      seed: req.seed,
      maxActions: req.maxActions,
      maxWallMs: req.maxMinutes * 60_000,
      maxFindings: req.maxFindings,
      noveltyPlateauLimit: 40,
    },
  );
  progress(`native hunt stopped: ${result.stoppedReason}`);
  return {
    runId: result.runId,
    seed: result.seed,
    stoppedReason: result.stoppedReason,
    actionsExecuted: result.actionsExecuted,
    statesVisited: result.statesVisited,
    resets: 0,
    anomalyCount: result.anomalies,
    findings: result.findings,
    evidenceBundles: result.evidenceBundles,
    findingOutcomes: result.findingOutcomes.map((o) => ({
      classKey: o.classKey,
      outcome: o.outcome,
      ...(o.detail !== undefined ? { detail: o.detail } : {}),
      ...(o.findingId !== undefined ? { findingId: o.findingId } : {}),
    })),
    warnings: result.warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Fake hunt: deterministic seeded walk over the fake adapter's state   *
 * machine. The generic inventory cannot drive the fake vocabulary      *
 * (openForm/fillField/submit), so the walker drives it directly and    *
 * pushes failures through the SAME finding pipeline (ingest ->         *
 * reproduce -> minimize -> confirm -> bundle) as the web hunt.         *
 * ------------------------------------------------------------------- */

const FAKE_FILL_VALUES = ["ok", "ok", "", "x".repeat(80), "<script>", "BAD"] as const;

function fakeAction(run: RunController, kind: string, input?: Record<string, unknown>): Action {
  return {
    id: newId("act"),
    runId: run.runId,
    environmentId: run.environmentId,
    kind,
    risk: "interact",
    deadlineMs: 5000,
    idempotency: "safe-retry",
    ...(input !== undefined ? { input } : {}),
  };
}

function nextFakeAction(
  rng: ReturnType<typeof mulberry32>,
  state: string,
  pendingFillIsBoundary: boolean,
): { kind: string; input?: Record<string, unknown> } {
  switch (state) {
    case "form":
      // Explorer discipline: a boundary value just entered the field, so the
      // very next move is to submit it (otherwise later fills overwrite the
      // hazard and it never reaches the oracle).
      if (pendingFillIsBoundary) return { kind: "submit" };
      // Weight filling over submitting so boundary values reach the defect.
      return rng.pick(["submit", "fillField", "fillField"] as const) === "submit"
        ? { kind: "submit" }
        : { kind: "fillField", input: { name: "default", value: rng.pick(FAKE_FILL_VALUES) } };
    case "done":
      return rng.pick([{ kind: "goHome" }, { kind: "toggleFlag" }] as const);
    case "error":
      return rng.pick([{ kind: "retry" }, { kind: "goHome" }] as const);
    case "home":
    default:
      return rng.pick([
        { kind: "openForm" },
        { kind: "toggleFlag" },
        { kind: "goHome" },
      ] as const);
  }
}

interface FakeFindingSinks {
  findings: Finding[];
  bundles: EvidenceBundle[];
  outcomes: HuntOutcomeEntry[];
  seenClassKeys: Set<string>;
  warnings: string[];
}

async function runFakeHunt(
  run: RunController,
  store: Store,
  req: HuntRequest,
  progress: ProgressFn,
): Promise<HuntRunResult> {
  const engine = new FindingEngine(OracleEngine.defaults(), store);
  const sinks: FakeFindingSinks = {
    findings: [],
    bundles: [],
    outcomes: [],
    seenClassKeys: new Set<string>(),
    warnings: [],
  };
  const rng = mulberry32(req.seed >>> 0);
  const statesSeen = new Set<string>(["home"]);
  const segment: Action[] = [];

  let state = "home";
  let pendingFillIsBoundary = false;
  let actionsExecuted = 0;
  let consecutiveRejections = 0;
  let stoppedReason = "action-budget";
  const startMs = Date.now();
  const maxWallMs = req.maxMinutes * 60_000;

  while (true) {
    if (actionsExecuted >= req.maxActions) {
      stoppedReason = "action-budget";
      break;
    }
    if (Date.now() - startMs > maxWallMs) {
      stoppedReason = "wall-budget";
      break;
    }
    if (req.maxFindings > 0 && sinks.findings.length >= req.maxFindings) {
      stoppedReason = "finding-cap";
      break;
    }

    const choice = nextFakeAction(rng, state, pendingFillIsBoundary);
    const action = fakeAction(run, choice.kind, choice.input);
    const submit = await run.submitAction(action);
    if (submit.kind === "adapter-error") {
      sinks.warnings.push(`adapter error during ${choice.kind}: ${submit.error}`);
      stoppedReason = "adapter-error";
      break;
    }
    if (submit.kind === "rejected") {
      sinks.warnings.push(
        `policy rejected ${choice.kind}: ${submit.decision.reason ?? "unknown reason"}`,
      );
      consecutiveRejections += 1;
      if (consecutiveRejections >= 10) {
        stoppedReason = "no-candidates";
        break;
      }
      continue;
    }
    if (submit.kind === "duplicate") {
      sinks.warnings.push(`duplicate submission for ${action.id}; outcome unresolved, skipping`);
      continue;
    }
    consecutiveRejections = 0;
    actionsExecuted += 1;
    segment.push(action);
    if (actionsExecuted % 25 === 0) progress(`... ${actionsExecuted} actions executed`);

    // Track the field under test: a boundary fill must be submitted next.
    if (choice.kind === "fillField") {
      pendingFillIsBoundary = choice.input?.value === "BAD";
    } else if (choice.kind === "submit" || choice.kind === "goHome") {
      pendingFillIsBoundary = false;
    }

    const outcome: ActionOutcome = submit.outcome;
    const failed =
      outcome.status === "target-failure" && outcome.error?.code === "TARGET_FAILURE";
    if (failed) {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
      try {
        await processFakeFailure(engine, run, outcome, segment.slice(), req, sinks, progress);
      } catch (e) {
        // One broken reproduction must not destroy the hunt: record and move on.
        const detail = e instanceof Error ? e.message : String(e);
        sinks.warnings.push(`finding pipeline failed: ${detail}`);
        sinks.outcomes.push({
          classKey: `TARGET_FAILURE|${outcome.error?.message ?? ""}`,
          outcome: "error",
          detail,
        });
      }
    } else {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
    }
    // Back at baseline: truncate the cumulative path so each reproducer is a
    // clean segment starting from the home state.
    if (state === "home") segment.length = 0;
  }

  return {
    runId: run.runId,
    seed: req.seed,
    stoppedReason,
    actionsExecuted,
    statesVisited: statesSeen.size,
    resets: 0,
    anomalyCount: sinks.seenClassKeys.size,
    findings: sinks.findings,
    evidenceBundles: sinks.bundles,
    findingOutcomes: sinks.outcomes,
    warnings: sinks.warnings,
  };
}

/** Ingest -> reproduce -> minimize -> confirm -> bundle for one fake failure. */
async function processFakeFailure(
  engine: FindingEngine,
  run: RunController,
  outcome: ActionOutcome,
  path: Action[],
  req: HuntRequest,
  sinks: FakeFindingSinks,
  progress: ProgressFn,
): Promise<void> {
  const message = outcome.error?.message ?? "deterministic oracle failure";
  const classKey = `TARGET_FAILURE|${message}`;
  if (sinks.seenClassKeys.has(classKey)) return;
  sinks.seenClassKeys.add(classKey);

  if (req.maxFindings > 0 && sinks.findings.length >= req.maxFindings) {
    sinks.outcomes.push({ classKey, outcome: "skipped-finding-cap" });
    return;
  }

  const signalKind = ORACLE_SIGNAL_KINDS.includes(message)
    ? (message as OracleSignalKind)
    : "TARGET_FAILURE";
  const signal: OracleSignal = { kind: signalKind, detail: outcome.error?.detail ?? message };
  progress(`candidate defect detected (${signalKind})`);

  const finding = engine.ingest(signal, {
    runId: run.runId,
    title:
      message === signalKind
        ? `${signalKind} from deterministic oracle`
        : `${signalKind}: ${message}`,
    adapter: run.caps.adapter,
  });
  const makeDriver = () => new FakeStateMachineDriver();

  const rep = await engine.reproduce(finding, path, makeDriver(), {
    attempts: 2,
    minSuccesses: 1,
  });
  const record = (name: string, detail?: string) => {
    const entry: HuntOutcomeEntry = { classKey, outcome: name, findingId: finding.id };
    if (detail !== undefined) entry.detail = detail;
    sinks.outcomes.push(entry);
  };

  if (rep.finding.status === "REJECTED") {
    record("rejected", rep.stats.lastError ?? "reproduction policy not satisfied");
    return;
  }
  if (rep.finding.status === "FLAKY") {
    record(
      "flaky",
      `reproduction flaky (${rep.stats.successes}/${rep.stats.attempts} attempts reproduced)`,
    );
    return;
  }

  const minimized = await engine.minimize(rep.finding, path, makeDriver());
  let confirmed = rep.finding;
  if (rep.finding.status === "MINIMIZED") {
    if (rep.finding.minimization?.verifiedReproduction === true) {
      confirmed = engine.transition(rep.finding, "CONFIRMED", {
        reason: "minimization verified reproduction",
      });
      record("confirmed");
    } else {
      confirmed = engine.transition(rep.finding, "REJECTED", {
        reason: "minimization did not verify reproduction",
      });
      record("rejected", "minimization did not verify reproduction");
      return;
    }
  } else {
    record(
      "confirmed-unverified-minimization",
      "minimize() baseline verification failed; confirmed by reproduction policy only",
    );
  }

  const bundle = engine.buildBundle(confirmed, path, minimized, {
    signals: mergeSignals(rep.lastSignals, [signal]),
    replayCommand: `inspector replay --finding ${confirmed.id}`,
  });
  sinks.findings.push(confirmed);
  sinks.bundles.push(bundle);
}

/* ------------------------------------------------------------------ *
 * Command entry: wiring, teardown, output, exit codes.                *
 * ------------------------------------------------------------------ */

export interface CommandContext {
  /** The process working directory (fallback workspace root). */
  baseCwd: string;
  /** --workspace value observed before the command token, if any. */
  workspaceArg?: string;
  json: boolean;
  /** Write a line to stdout (final summaries). */
  out: (line: string) => void;
  /** Write a progress line to stderr (suppressed under --json). */
  progress: (line: string) => void;
}

/**
 * Resolve the workspace directory: the command's own --workspace flag wins,
 * then a pre-command --workspace, then INSPECTOR_WORKSPACE, then the working
 * directory. --workspace is THE isolation mechanism: `pnpm run` re-cwd's to
 * the package directory before executing, so an absent --workspace cannot be
 * assumed to resolve to the operator's shell cwd.
 */
export function workDirOf(ctx: CommandContext, parsed: ParsedInvocation): string {
  return parsed.workspace ?? ctx.workspaceArg ?? process.env.INSPECTOR_WORKSPACE ?? ctx.baseCwd;
}

/**
 * Warn on stderr (suppressed under --json) when the resolved workspace is the
 * Inspector repository root; returns the message so JSON payloads can carry a
 * `warning` field instead.
 */
export function warnRepoRootWorkspace(ctx: CommandContext, dir: string): string | null {
  if (!isRepoRoot(dir)) return null;
  if (!ctx.json) ctx.progress(REPO_ROOT_WARNING);
  return REPO_ROOT_WARNING;
}

export async function huntCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  const req = parseHuntRequest(parsed);
  const dir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, dir);
  let workspace: ReturnType<typeof openWorkspace>;
  try {
    workspace = openWorkspace(dir);
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  const { store, artifacts, base } = workspace;
  let run: RunController | null = null;
  try {
    const mgr = new RunManager(store, artifacts, new PolicyEngine(huntPolicy(req)));
    // RC1 external targets flow through WEB_TARGET_URL: RunManager issues the
    // lifecycle create itself, and the web adapter bin reads this env var as
    // its constructor-level default target.
    const webTarget = req.adapter === "web" && req.targetUrl !== undefined;
    const isNative =
      req.adapter === "cli" || req.adapter === "windows" || req.adapter === "android";
    const spawnSpec = webTarget
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
      run = await mgr.startRun({
        ...spawnSpec,
        // Persisted so runs resume re-creates the SAME target, never the default.
        ...(webTarget ? { createOptions: { targetUrl: req.targetUrl }, spawnEnvDelta: { WEB_TARGET_URL: req.targetUrl } } : {}),
        ...(createOptions ? { createOptions } : {}),
        ...(spawnEnvDelta ? { spawnEnvDelta } : {}),
        // Real-device adapters need headroom on observe (uiautomator dumps).
        ...(isNative ? { observeTimeoutMs: 30000 } : {}),
      });
    } catch (e) {
      throw remapWorkspaceConflict(e);
    }

    const result =
      req.adapter === "web"
        ? await runWebHunt(run, store, req, base, ctx.progress)
        : isNative
          ? await runNativeHuntCommand(run, store, req, base, ctx.progress)
          : await runFakeHunt(run, store, req, ctx.progress);

    const bundlePaths = writeEvidenceBundles(base, result.runId, result.evidenceBundles);
    const errorOutcomes = result.findingOutcomes.filter((o) => o.outcome === "error");
    const badStop =
      result.stoppedReason === "adapter-error" ||
      result.stoppedReason === "initial-observe-failed";
    const code = badStop || errorOutcomes.length > 0 ? 1 : 0;

    const summary = {
      ok: code === 0,
      ...(warning !== null ? { warning } : {}),
      runId: result.runId,
      adapter: req.adapter,
      seed: result.seed,
      stoppedReason: result.stoppedReason,
      actionsExecuted: result.actionsExecuted,
      statesVisited: result.statesVisited,
      resets: result.resets,
      anomalies: result.anomalyCount,
      findings: result.findings.map((f) => ({
        id: f.id,
        signature: f.signature ?? null,
        status: f.status,
        severity: f.severity,
        confidence: f.confidence,
      })),
      bundles: [...bundlePaths.entries()].map(([findingId, path]) => ({ findingId, path })),
      warnings: result.warnings,
    };

    if (ctx.json) {
      ctx.out(JSON.stringify(summary, null, 2));
    } else {
      ctx.out(`hunt complete: ${result.runId}`);
      ctx.out(
        `  stopped: ${result.stoppedReason} | actions: ${result.actionsExecuted} | ` +
          `states: ${result.statesVisited} | resets: ${result.resets} | anomalies: ${result.anomalyCount}`,
      );
      if (result.findings.length === 0) {
        ctx.out("  findings: none");
      } else {
        ctx.out(`  findings: ${result.findings.length}`);
        for (const f of result.findings) {
          ctx.out(
            `    ${f.id}  ${f.signature ?? "-"}  ${f.status}  ${f.severity}  ${f.confidence.toFixed(2)}`,
          );
          const p = bundlePaths.get(f.id);
          if (p) ctx.out(`      evidence: ${p}`);
        }
      }
      if (result.warnings.length > 0) {
        ctx.out(`  warnings: ${result.warnings.length}`);
        for (const w of result.warnings) ctx.out(`    - ${w}`);
      }
      if (code !== 0) {
        ctx.out(
          badStop
            ? `hunt failed: exploration stopped with '${result.stoppedReason}'`
            : `hunt finished with ${errorOutcomes.length} error-level finding outcome(s)`,
        );
      }
    }
    return { code, data: summary };
  } finally {
    if (run) await closeRunGuarded(run, ctx.progress);
    store.close();
  }
}
