import { mkdirSync } from "node:fs";
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
import {
  ExploreController,
  WebReplayDriver,
  runNativeHunt,
  type ExploreConfig,
  type NativeExplorationConfig,
  type NativeSessionDeps,
  EXPLORER_VERSION,
  configFingerprint,
  loadLatestCheckpoint,
  writeCheckpoint,
  StateGraph,
  mulberry32,
  restoreRng,
  type ExplorationCheckpointPayload,
  type FindingOutcomeSnapshot,
} from "@inspector/explore";
import type { ParsedInvocation } from "./args.js";
import { CliError, intFlag } from "./args.js";
import { adapterSpawn, isRepoRoot, openWorkspace, REPO_ROOT_WARNING, remapWorkspaceConflict } from "./workspace.js";
import { writeJsonAtomic } from "./atomic.js";

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
  resumeRunId?: string;
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
  const resumeRaw = parsed.flags["--resume"];
  if (resumeRaw !== undefined && typeof resumeRaw !== "string") {
    throw new CliError("invalid-value", "--resume requires a run id");
  }
  if (resumeRaw !== undefined && parsed.positionals.length > 0) {
    throw new CliError("invalid-value", "hunt --resume takes the run id as the --resume value, not a positional argument");
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
    ...(typeof resumeRaw === "string" ? { resumeRunId: resumeRaw } : {}),
  };
}

export function webExploreConfig(req: HuntRequest): ExploreConfig {
  return {
    seed: req.seed,
    maxActions: req.maxActions,
    maxWallMs: req.maxMinutes * 60_000,
    maxFindings: req.maxFindings,
    maxResets: 40,
    noveltyPlateauLimit: 50,
    reproducibleAttempts: 2,
    reproducibleMinSuccesses: 1,
    enableFaultInjection: false,
    observeFields: ["url", "title", "uiTree", "storage", "pageErrors", "screenshot"],
    targetUrl: req.targetUrl,
  };
}

export function nativeExploreConfig(req: HuntRequest): NativeExplorationConfig {
  return {
    seed: req.seed,
    maxActions: req.maxActions,
    maxWallMs: req.maxMinutes * 60_000,
    maxFindings: req.maxFindings,
    noveltyPlateauLimit: 40,
  };
}

export function fakeExploreConfig(req: HuntRequest): Omit<HuntRequest, "resumeRunId"> {
  const { resumeRunId: _resumeRunId, ...config } = req;
  return config;
}

interface DurableHuntMeta {
  schema: "inspector-hunt/1";
  version: 1;
  workflow: "hunt" | "explore";
  request: Omit<HuntRequest, "resumeRunId">;
  explorerKind: "web" | "native" | "fake";
  explorerVersion: string;
}

function durableHuntMeta(req: HuntRequest, workflow: "hunt" | "explore"): DurableHuntMeta {
  const { resumeRunId: _resumeRunId, ...request } = req;
  return {
    schema: "inspector-hunt/1",
    version: 1,
    workflow,
    request,
    explorerKind: req.adapter === "web" ? "web" : req.adapter === "fake" ? "fake" : "native",
    explorerVersion: EXPLORER_VERSION,
  };
}

function storedAdapterSpawn(adapter: string | null): ReturnType<typeof adapterSpawn> | null {
  if (adapter === "adapter-fake") return adapterSpawn("fake");
  if (adapter === "web-playwright") return adapterSpawn("web");
  if (adapter === "cli-pty") return adapterSpawn("cli");
  if (adapter === "windows-uia") return adapterSpawn("windows");
  if (adapter === "android-uiautomator") return adapterSpawn("android");
  return null;
}

function parseDurableHuntMeta(raw: string | null, runId: string): DurableHuntMeta {
  if (!raw) throw new CliError("not-resumable", `run ${runId} has no durable autonomous hunt configuration`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CliError("not-resumable", `run ${runId} has malformed autonomous hunt configuration; refusing to guess`);
  }
  if (!isRecord(value) || value.schema !== "inspector-hunt/1" || value.version !== 1 || !isRecord(value.request) || value.explorerVersion !== EXPLORER_VERSION) {
    throw new CliError("not-resumable", `run ${runId} has an incompatible autonomous hunt configuration; refusing to guess`);
  }
  const workflow = value.workflow === undefined ? "hunt" : value.workflow;
  if (workflow !== "hunt" && workflow !== "explore") {
    throw new CliError("not-resumable", `run ${runId} has an invalid autonomous workflow; refusing to guess`);
  }
  const request = value.request;
  const adapters = new Set(["web", "fake", "cli", "windows", "android"]);
  if (
    typeof request.adapter !== "string" ||
    !adapters.has(request.adapter) ||
    !Number.isSafeInteger(request.seed) ||
    !Number.isSafeInteger(request.maxActions) ||
    !Number.isSafeInteger(request.maxMinutes) ||
    !Number.isSafeInteger(request.maxFindings) ||
    (request.seed as number) < 0 || (request.maxActions as number) < 0 || (request.maxMinutes as number) < 0 || (request.maxFindings as number) < 0 ||
    (request.targetUrl !== undefined && typeof request.targetUrl !== "string") ||
    (request.target !== undefined && typeof request.target !== "string")
  ) {
    throw new CliError("not-resumable", `run ${runId} has an invalid autonomous hunt configuration; refusing to guess`);
  }
  if (typeof request.targetUrl === "string") {
    try {
      validateTargetUrl(request.targetUrl);
    } catch {
      throw new CliError("not-resumable", `run ${runId} has an invalid persisted target URL; refusing to resume`);
    }
  }
  const explorerKind = value.explorerKind;
  const expectedKind = request.adapter === "web" ? "web" : request.adapter === "fake" ? "fake" : "native";
  if (explorerKind !== expectedKind) {
    throw new CliError("incompatible-run", `run ${runId} records explorer '${String(explorerKind)}' for adapter '${request.adapter}'`);
  }
  return {
    schema: "inspector-hunt/1",
    version: 1,
    workflow,
    request: request as DurableHuntMeta["request"],
    explorerKind: explorerKind as DurableHuntMeta["explorerKind"],
    explorerVersion: value.explorerVersion,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeResumeRequest(
  parsed: ParsedInvocation,
  requested: HuntRequest,
  meta: DurableHuntMeta,
): HuntRequest {
  const original = meta.request;
  const checks: Array<[string, string]> = [
    ["--adapter", "adapter"],
    ["--url", "targetUrl"],
    ["--target", "target"],
    ["--seed", "seed"],
    ["--max-actions", "maxActions"],
    ["--max-minutes", "maxMinutes"],
    ["--max-findings", "maxFindings"],
  ];
  for (const [flag, key] of checks) {
    if (parsed.flags[flag] === undefined) continue;
    const requestedValue = requested[key as keyof HuntRequest];
    const originalValue = original[key as keyof typeof original];
    if (requestedValue !== originalValue) {
      throw new CliError(
        "incompatible-override",
        `${flag}=${String(requestedValue)} does not match the original run value ${String(originalValue)}; resume refuses incompatible overrides`,
      );
    }
  }
  return { ...original, resumeRunId: requested.resumeRunId };
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
    writeJsonAtomic(path, bundle);
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
  resume = false,
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
    config: webExploreConfig(req),
    resume,
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
  resume = false,
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
    { run, findingEngine, store, resume, ...(replayDriverFactory ? { replayDriverFactory } : {}) },
    nativeExploreConfig(req),
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
  resume = false,
): Promise<HuntRunResult> {
  const engine = new FindingEngine(OracleEngine.defaults(), store);
  const sinks: FakeFindingSinks = {
    findings: [],
    bundles: [],
    outcomes: [],
    seenClassKeys: new Set<string>(),
    warnings: [],
  };
  const campaign = store.getExplorationCampaign(run.runId);
  const config = fakeExploreConfig(req);
  const budget = {
    maxActions: req.maxActions,
    maxResets: 0,
    maxFindings: req.maxFindings,
    maxWallMs: req.maxMinutes * 60_000,
  };
  const restored = resume
    ? (() => {
        if (!campaign) throw new CliError("not-resumable", `run ${run.runId} has no durable fake exploration campaign`);
        return loadLatestCheckpoint(store, {
          runId: run.runId,
          explorerKind: "fake",
          explorerVersion: EXPLORER_VERSION,
          adapter: campaign.adapter,
          seed: req.seed >>> 0,
          configFingerprint: configFingerprint(config),
        }, budget);
      })()
    : null;
  if (resume && !restored) throw new CliError("not-resumable", `run ${run.runId} has no fake exploration checkpoint`);
  if (restored) {
    for (const key of restored.anomalyClassKeys) sinks.seenClassKeys.add(key);
    sinks.outcomes.push(...restored.findingOutcomes.map((outcome) => ({
      classKey: outcome.classKey,
      outcome: outcome.outcome,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(outcome.findingId !== undefined ? { findingId: outcome.findingId } : {}),
    })));
  }
  let rng = restored ? restoreRng(restored.rng) : mulberry32(req.seed >>> 0);
  const statesSeen = new Set<string>(restored?.fake?.statesSeen ?? ["home"]);
  const segment: Action[] = restored?.fake?.segment?.slice() ?? [];
  const blocked = new Set<string>(restored?.toxicActionKeys ?? []);
  const rejected = new Set<string>(restored?.rejectedActionKeys ?? []);
  const processed = new Set<string>(restored?.processedFindingClassKeys ?? []);
  if (resume) {
    for (const record of store.listFindings(1000)) {
      if (record.runId !== run.runId || !record.classKey) continue;
      const terminal = ["CONFIRMED", "RESOLVED", "REGRESSED", "REJECTED", "FLAKY"].includes(record.status);
      if (!terminal) continue;
      sinks.seenClassKeys.add(record.classKey);
      processed.add(record.classKey);
      if (sinks.outcomes.some((outcome) => outcome.classKey === record.classKey)) continue;
      if (["CONFIRMED", "RESOLVED", "REGRESSED"].includes(record.status)) {
        const finding = engine.rehydrate(record);
        if (!sinks.findings.some((existing) => existing.id === finding.id)) sinks.findings.push(finding);
        sinks.outcomes.push({ classKey: record.classKey, outcome: "confirmed", findingId: finding.id });
      } else {
        sinks.outcomes.push({ classKey: record.classKey, outcome: record.status.toLowerCase(), findingId: record.id });
      }
    }
  }
  let state = restored?.fake?.state ?? "home";
  let pendingFillIsBoundary = restored?.fake?.pendingFillIsBoundary ?? false;
  let actionsExecuted = restored?.actionsExecuted ?? 0;
  let consecutiveRejections = 0;
  let stoppedReason = "action-budget";
  const campaignStartMs = Date.parse(campaign?.createdAt ?? restored?.campaignStartedAt ?? new Date().toISOString());
  const startMs = Number.isFinite(campaignStartMs) ? campaignStartMs : Date.now();
  const graph = restored ? StateGraph.fromSnapshot(restored.graph) : new StateGraph();
  if (!restored) graph.visitState("home", "fake:home", 0);
  let checkpointStepSequence = restored?.stepSequence ?? 0;

  const reconcile = (): void => {
    for (const unresolved of store.getInFlightActions(run.runId)) {
      const metadata = parseFakeMetadata(unresolved.metadata_json);
      if (metadata?.actionKey) blocked.add(metadata.actionKey);
      if (metadata?.rngAfter) rng = restoreRng(metadata.rngAfter);
    }
    const durable = store.countRunActions(run.runId);
    for (const committed of store.listCommittedActionsAfterStep(run.runId, checkpointStepSequence)) {
      const metadata = parseFakeMetadata(committed.action.metadata_json);
      if (!metadata?.actionKey) continue;
      if (metadata.rngAfter) rng = restoreRng(metadata.rngAfter);
      const before = metadata.stateBefore ?? state;
      const after = committed.action.state_after;
      if (after) {
        state = after;
        statesSeen.add(after);
        graph.visitState(after, `fake:${after}`, durable);
      }
      graph.recordEdge(before, metadata.actionKey, after, durable);
      const reconstructed = fakeActionFromRecord(committed.action, metadata);
      if (reconstructed) {
        segment.push(reconstructed);
        if (reconstructed.kind === "fillField") {
          pendingFillIsBoundary = reconstructed.input?.value === "BAD";
        } else if (reconstructed.kind === "submit" || reconstructed.kind === "goHome") {
          pendingFillIsBoundary = false;
        }
      }
      if (state === "home") segment.length = 0;
    }
    actionsExecuted = Math.max(actionsExecuted, durable);
    checkpointStepSequence = Math.max(checkpointStepSequence, store.maxRunStepSequence(run.runId));
  };

  const checkpoint = (): void => {
    if (!campaign) return;
    actionsExecuted = Math.max(actionsExecuted, store.countRunActions(run.runId));
    const payload: ExplorationCheckpointPayload = {
      schema: "inspector-exploration-checkpoint/1",
      version: 1,
      runId: run.runId,
      explorerKind: "fake",
      explorerVersion: EXPLORER_VERSION,
      adapter: campaign.adapter,
      seed: req.seed >>> 0,
      configFingerprint: configFingerprint(config),
      rng: rng.snapshot(),
      stepSequence: store.maxRunStepSequence(run.runId),
      campaignStartedAt: campaign.createdAt,
      actionsExecuted,
      resets: 0,
      actionsSinceNewState: 0,
      recentActionKeys: [],
      toxicActionKeys: [...blocked].sort(),
      rejectedActionKeys: [...rejected].sort(),
      currentState: state,
      currentScreen: `fake:${state}`,
      graph: graph.snapshot(),
      actionKindSequence: [],
      actionPath: segment.slice(),
      anomalies: [],
      anomalyClassKeys: [...sinks.seenClassKeys].sort(),
      processedFindingClassKeys: [...processed].sort(),
      findingOutcomes: sinks.outcomes.map((outcome) => ({
        anomalyKey: outcome.classKey,
        classKey: outcome.classKey,
        outcome: outcome.outcome,
        ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        ...(outcome.findingId !== undefined ? { findingId: outcome.findingId } : {}),
      } satisfies FindingOutcomeSnapshot)),
      budget,
      fake: { state, pendingFillIsBoundary, statesSeen: [...statesSeen].sort(), segment: segment.slice() },
    };
    writeCheckpoint(store, payload);
    checkpointStepSequence = payload.stepSequence;
  };

  reconcile();
  checkpoint();
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
    if (req.maxFindings > 0 && sinks.outcomes.filter((o) => o.outcome.startsWith("confirmed")).length >= req.maxFindings) {
      stoppedReason = "finding-cap";
      break;
    }

    let choice: { kind: string; input?: Record<string, unknown> } | null = null;
    let actionKey = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = nextFakeAction(rng, state, pendingFillIsBoundary);
      const candidateKey = fakeChoiceKey(candidate);
      if (blocked.has(candidateKey) || rejected.has(candidateKey)) continue;
      choice = candidate;
      actionKey = candidateKey;
      break;
    }
    if (!choice) {
      stoppedReason = "no-candidates";
      break;
    }
    const stateBeforeAction = state;
    const action = fakeAction(run, choice.kind, choice.input);
    action.metadata = { exploration: { actionKey, stateBefore: state, rngAfter: rng.snapshot() } };
    const submit = await run.submitAction(action);
    if (submit.kind === "adapter-error") {
      sinks.warnings.push(`adapter error during ${choice.kind}: ${submit.error}`);
      stoppedReason = "adapter-error";
      blocked.add(actionKey);
      checkpoint();
      break;
    }
    if (submit.kind === "rejected") {
      sinks.warnings.push(
        `policy rejected ${choice.kind}: ${submit.decision.reason ?? "unknown reason"}`,
      );
      consecutiveRejections += 1;
      rejected.add(actionKey);
      blocked.add(actionKey);
      checkpoint();
      if (consecutiveRejections >= 10) {
        stoppedReason = "no-candidates";
        break;
      }
      continue;
    }
    if (submit.kind === "duplicate") {
      sinks.warnings.push(`duplicate submission for ${action.id}; outcome unresolved, skipping`);
      blocked.add(actionKey);
      checkpoint();
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
        await processFakeFailure(
          engine,
          run,
          outcome,
          segment.slice(),
          req,
          sinks,
          progress,
          processed,
          store,
        );
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
      processed.add(`TARGET_FAILURE|${outcome.error?.message ?? ""}`);
    } else {
      state = typeof outcome.stateAfter === "string" ? outcome.stateAfter : state;
      statesSeen.add(state);
    }
    // Back at baseline: truncate the cumulative path so each reproducer is a
    // clean segment starting from the home state.
    if (state === "home") segment.length = 0;
    graph.visitState(state, `fake:${state}`, actionsExecuted);
    graph.recordEdge(
      stateBeforeAction,
      actionKey,
      state,
      actionsExecuted,
    );
    checkpoint();
  }

  checkpoint();

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

function fakeChoiceKey(choice: { kind: string; input?: Record<string, unknown> }): string {
  return `fake:${choice.kind}:${JSON.stringify(choice.input ?? null)}`;
}

interface FakeStoredMetadata {
  actionKey?: string;
  stateBefore?: string;
  rngAfter?: import("@inspector/explore").RngSnapshot;
  input?: Record<string, unknown> | null;
}

function parseFakeMetadata(raw: string | null): FakeStoredMetadata | null {
  if (!raw) return null;
  try {
    const wrapper = JSON.parse(raw) as {
      input?: Record<string, unknown> | null;
      metadata?: { exploration?: FakeStoredMetadata } | null;
    };
    const exploration = wrapper.metadata?.exploration;
    if (!exploration || typeof exploration !== "object") return null;
    return {
      ...(typeof exploration.actionKey === "string" ? { actionKey: exploration.actionKey } : {}),
      ...(typeof exploration.stateBefore === "string" ? { stateBefore: exploration.stateBefore } : {}),
      ...(exploration.rngAfter !== undefined ? { rngAfter: exploration.rngAfter } : {}),
      ...(wrapper.input !== undefined ? { input: wrapper.input } : {}),
    };
  } catch {
    return null;
  }
}

function fakeActionFromRecord(record: import("@inspector/store-sqlite").ActionRecord, metadata: FakeStoredMetadata): Action | null {
  return {
    id: record.id,
    runId: record.run_id,
    environmentId: record.environment_id,
    kind: record.kind,
    risk: record.risk as Action["risk"],
    deadlineMs: record.deadline_ms,
    idempotency: record.idempotency as Action["idempotency"],
    target: null,
    input: metadata.input ?? null,
    metadata: { exploration: metadata },
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
  processedFindingClassKeys: Set<string>,
  store: Store,
): Promise<void> {
  const message = outcome.error?.message ?? "deterministic oracle failure";
  const classKey = `TARGET_FAILURE|${message}`;
  if (processedFindingClassKeys.has(classKey)) return;
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

  const durable = store.getFindingByClassKey(run.runId, classKey);
  let finding = durable
    ? engine.rehydrate(durable)
    : engine.ingest(signal, {
        runId: run.runId,
        title:
          message === signalKind
            ? `${signalKind} from deterministic oracle`
            : `${signalKind}: ${message}`,
        adapter: run.caps.adapter,
        classKey,
      });
  if (finding.status === "REPRODUCING") {
    finding = engine.transition(finding, "CANDIDATE", {
      reason: "controller restarted during reproduction",
      actor: "exploration-resume",
    });
  }
  if (finding.status === "MINIMIZED" && finding.minimization?.verifiedReproduction === true) {
    finding = engine.transition(finding, "CONFIRMED", {
      reason: "resume completed persisted minimization",
      actor: "exploration-resume",
    });
  }
  if (finding.status === "CONFIRMED" || finding.status === "RESOLVED" || finding.status === "REGRESSED") {
    sinks.findings.push(finding);
    sinks.outcomes.push({ classKey, outcome: "confirmed", findingId: finding.id });
    return;
  }
  if (finding.status === "REJECTED" || finding.status === "FLAKY") {
    sinks.outcomes.push({ classKey, outcome: finding.status.toLowerCase(), findingId: finding.id });
    return;
  }
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
  return runExplorationCommand(parsed, ctx, "hunt");
}

/**
 * Explicit operator exploration workflow. It shares the proven hunt engine,
 * but records a distinct workflow and emits coverage/novelty-oriented output.
 * Exploration never grants patching permission and accepts no repair flag.
 */
export async function exploreCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
): Promise<{ code: number; data?: unknown }> {
  return runExplorationCommand(parsed, ctx, "explore");
}

async function runExplorationCommand(
  parsed: ParsedInvocation,
  ctx: CommandContext,
  workflow: "hunt" | "explore",
): Promise<{ code: number; data?: unknown }> {
  let req = parseHuntRequest(parsed);
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
  let resuming = false;
  try {
    let storedRun: ReturnType<Store["getRun"]> = undefined;
    let storedCampaign: ReturnType<Store["getExplorationCampaign"]> = undefined;
    let storedSpawn: ReturnType<typeof storedAdapterSpawn> = null;
    if (req.resumeRunId) {
      resuming = true;
      const resumeRunId = req.resumeRunId;
      storedRun = store.getRun(resumeRunId);
      if (!storedRun) throw new CliError("not-found", `run not found: ${resumeRunId}`);
      if (["closed", "failed", "crashed", "complete", "resolved"].includes(storedRun.status)) {
        throw new CliError("terminal-run", `run ${resumeRunId} is already ${storedRun.status}; a terminal autonomous hunt cannot resume`);
      }
      const meta = parseDurableHuntMeta(storedRun.meta_json, resumeRunId);
      if (meta.workflow !== workflow) {
        throw new CliError(
          "incompatible-run",
          `run ${resumeRunId} was created by '${meta.workflow}', not '${workflow}'; resume with the matching command`,
        );
      }
      req = mergeResumeRequest(parsed, req, meta);
      if (meta.request.adapter !== req.adapter) {
        throw new CliError("incompatible-run", `run ${req.resumeRunId} records adapter '${meta.request.adapter}', not '${req.adapter}'`);
      }
      storedCampaign = store.getExplorationCampaign(resumeRunId);
      if (!storedCampaign) {
        throw new CliError("not-resumable", `run ${resumeRunId} has no durable exploration campaign; use 'runs resume' for environment-only reattachment`);
      }
      storedSpawn = storedAdapterSpawn(storedRun.adapter);
      if (!storedSpawn) {
        throw new CliError(
          "unknown-adapter",
          `cannot determine the original adapter for run ${resumeRunId} (recorded '${storedRun.adapter ?? "unknown"}'); refusing to guess`,
        );
      }
      const explorerKind = req.adapter === "web" ? "web" : req.adapter === "fake" ? "fake" : "native";
      if (storedCampaign.explorerKind !== explorerKind || storedCampaign.adapter !== storedRun.adapter) {
        throw new CliError("incompatible-run", `run ${resumeRunId} explorer/adapter provenance is inconsistent; refusing to resume`);
      }
      if (explorerKind === "web") {
        loadLatestCheckpoint(store, {
          runId: resumeRunId,
          explorerKind: "web",
          explorerVersion: EXPLORER_VERSION,
          adapter: storedCampaign.adapter,
          seed: req.seed >>> 0,
          configFingerprint: configFingerprint(webExploreConfig(req)),
        }, webExploreConfig(req) && {
          maxActions: webExploreConfig(req).maxActions,
          maxResets: webExploreConfig(req).maxResets ?? 0,
          maxFindings: webExploreConfig(req).maxFindings ?? 0,
          maxWallMs: webExploreConfig(req).maxWallMs ?? 0,
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
    const mgr = new RunManager(store, artifacts, new PolicyEngine(huntPolicy(req)));
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
          runMeta: durableHuntMeta(req, workflow),
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
        ? await runWebHunt(run, store, req, base, ctx.progress, resuming)
        : isNative
          ? await runNativeHuntCommand(run, store, req, base, ctx.progress, resuming)
           : await runFakeHunt(run, store, req, ctx.progress, resuming);

    const bundlePaths = writeEvidenceBundles(base, result.runId, result.evidenceBundles);
    const errorOutcomes = result.findingOutcomes.filter((o) => o.outcome === "error");
    const badStop =
      result.stoppedReason === "adapter-error" ||
      result.stoppedReason === "initial-observe-failed";
    const code = badStop || errorOutcomes.length > 0 ? 1 : 0;

    const huntSummary = {
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
    const summary = workflow === "explore"
      ? {
          schema: "inspector-cli/explore/1" as const,
          ok: huntSummary.ok,
          command: "explore" as const,
          warning,
          runId: result.runId,
          adapter: req.adapter,
          seed: result.seed,
          resumed: resuming,
          stoppedReason: result.stoppedReason,
          campaign: {
            durable: true,
            checkpointed: true,
            resumeSupported: true,
            runId: result.runId,
          },
          coverage: {
            actionsExecuted: result.actionsExecuted,
            statesVisited: result.statesVisited,
            resets: result.resets,
            noveltyStates: result.statesVisited,
            anomalies: result.anomalyCount,
          },
          discovery: {
            findingsObserved: result.findings.length,
            confirmedFindings: result.findings.filter((f) => f.status === "CONFIRMED").length,
            lifecycle: "observations-feed-finding-pipeline",
          },
          patching: {
            enabled: false,
            reason: "explore is discovery-only; repair requires a separate explicit command",
          },
          findings: huntSummary.findings,
          bundles: huntSummary.bundles,
          warnings: result.warnings,
        }
      : huntSummary;

    if (ctx.json) {
      ctx.out(JSON.stringify(summary, null, 2));
    } else {
      ctx.out(`${workflow} complete: ${result.runId}`);
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
      if (workflow === "explore") {
        ctx.out("  patching: disabled (use inspector repair with a confirmed finding)");
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
