import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Action,
  EvidenceBundle,
  Finding,
  ReplayDriver,
} from "@inspector/finding";
import { FakeStateMachineDriver, FindingEngine, OracleEngine } from "@inspector/finding";
import type {
  EnvironmentRecord,
  FindingRecord,
  RunRecord,
  Store,
} from "@inspector/store-sqlite";
import { WebReplayDriver } from "@inspector/explore";
import { WorkflowError } from "./errors.js";

export type WorkflowClassification =
  | "reproduced"
  | "fixed"
  | "flaky"
  | "environment-failure"
  | "invalid-provenance"
  | "incompatible-target"
  | "skipped";

export class WorkflowProvenanceError extends Error {
  constructor(message: string, readonly classification: "invalid-provenance" | "incompatible-target" = "invalid-provenance") {
    super(message);
    this.name = "WorkflowProvenanceError";
  }
}

export interface LoadedReplaySubject {
  record: FindingRecord;
  finding: Finding;
  run: RunRecord;
  environment: EnvironmentRecord;
  bundle: EvidenceBundle;
  bundlePath: string;
}

/** Load and validate the durable finding + its immutable minimized evidence. */
export function loadReplaySubject(
  store: Store,
  base: string,
  findingId: string,
): LoadedReplaySubject {
  const record = store.getFinding(findingId);
  if (!record) throw new WorkflowError("not-found", `finding not found: ${findingId}`);
  if (!record.runId) {
    throw new WorkflowProvenanceError(`finding ${findingId} has no originating run`);
  }
  const run = store.getRun(record.runId);
  if (!run || !run.adapter) {
    throw new WorkflowProvenanceError(`finding ${findingId} has no durable adapter provenance`);
  }
  const environment = store.getEnvironmentForRun(record.runId);
  if (!environment || environment.adapter !== run.adapter) {
    throw new WorkflowProvenanceError(
      `finding ${findingId} has missing or inconsistent environment provenance`,
    );
  }
  const bundlePath = join(base, "bundles", record.runId, `${findingId}.json`);
  if (!existsSync(bundlePath)) {
    throw new WorkflowProvenanceError(
      `minimized reproducer for finding ${findingId} is missing at ${bundlePath}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(bundlePath, "utf8"));
  } catch (err) {
    throw new WorkflowProvenanceError(
      `evidence bundle for finding ${findingId} is unreadable: ${errorMessage(err)}`,
    );
  }
  assertBundle(raw, findingId, record.runId, run.adapter);
  const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
  const finding = findingEngine.rehydrate(record);
  if (finding.adapter !== null && finding.adapter !== run.adapter) {
    throw new WorkflowProvenanceError(
      `finding ${findingId} adapter '${finding.adapter}' does not match run adapter '${run.adapter}'`,
      "incompatible-target",
    );
  }
  if (raw.finding && typeof raw.finding === "object") {
    const bundleFinding = raw.finding as { revision?: unknown; adapter?: unknown };
    if (bundleFinding.adapter !== undefined && bundleFinding.adapter !== null && bundleFinding.adapter !== run.adapter) {
      throw new WorkflowProvenanceError(
        `evidence bundle adapter '${String(bundleFinding.adapter)}' does not match '${run.adapter}'`,
        "incompatible-target",
      );
    }
    if (
      finding.revision !== null &&
      bundleFinding.revision !== undefined &&
      bundleFinding.revision !== null &&
      bundleFinding.revision !== finding.revision
    ) {
      throw new WorkflowProvenanceError(
        `finding ${findingId} revision provenance disagrees with its evidence bundle`,
      );
    }
  }
  return {
    record,
    finding,
    run,
    environment,
    bundle: raw,
    bundlePath,
  };
}

/**
 * Platform-faithful replay factories keyed by DURABLE adapter identity
 * (HARDENING_5 H5.5: exhaustive single source; the matrix contract pins this
 * key set against the canonical family registry). An identity without an
 * entry is an explicit preflight refusal — never a fake/web substitution.
 */
type ReplayDeps = {
  subject: LoadedReplaySubject;
  base: string;
  createOptions: Record<string, unknown> | undefined;
  spawnEnv: Record<string, unknown> | undefined;
};

const REPLAY_DRIVER_FACTORIES: Record<
  string,
  (deps: ReplayDeps) => Promise<ReplayDriver>
> = {
  "adapter-fake": async () => new FakeStateMachineDriver(),
  "web-playwright": async ({ subject, base, createOptions, spawnEnv }) => {
    const targetUrl = stringValue(createOptions?.targetUrl) ?? stringValue(spawnEnv?.WEB_TARGET_URL);
    return new WebReplayDriver({
      targetUrl,
      artifactBaseDir: join(base, "replay", subject.finding.id),
    });
  },
  "cli-pty": async ({ subject, spawnEnv }) => {
    const { CliPtyReplayDriver } = await import("../../cli-adapter/src/replay.js");
    const program = stringValue(spawnEnv?.INSPECTOR_CLI_PROGRAM) ?? "seedcli";
    const raw = spawnEnv?.INSPECTOR_PTY;
    // H5-D11: backend identity must be durably pinned. Missing/malformed
    // values cannot be inferred from current-host capability.
    if (raw !== "real" && raw !== "mock") {
      throw new WorkflowProvenanceError(
        `cli finding ${subject.finding.id} lacks durable PTY backend provenance (INSPECTOR_PTY='${String(raw)}'); refusing to infer from current host`,
        "incompatible-target",
      );
    }
    if (raw === "real") {
      const { NodePtyBackend } = await import("../../cli-adapter/src/node-pty-backend.js");
      return new CliPtyReplayDriver({ program, backend: () => new NodePtyBackend() });
    }
    return new CliPtyReplayDriver({
      program,
      backend: "mock",
    });
  },
  "windows-uia": async ({ subject, createOptions, spawnEnv }) => {
    const { WindowsUiaReplayDriver } = await import("../../windows-adapter/src/replay.js");
    const title = stringValue(createOptions?.titleContains);
    const raw = spawnEnv?.INSPECTOR_WINDOWS_BACKEND;
    if (raw !== "mock" && raw !== "real") {
      throw new WorkflowProvenanceError(
        `windows finding ${subject.finding.id} lacks durable UIA backend provenance (INSPECTOR_WINDOWS_BACKEND='${String(raw)}'); refusing to reconstruct from current host`,
        "incompatible-target",
      );
    }
    if (raw === "mock") {
      const { MockUiaBackend } = await import("../../windows-adapter/src/mock-uia.js");
      return new WindowsUiaReplayDriver({ targetTitle: title, backend: new MockUiaBackend() });
    }
    return new WindowsUiaReplayDriver({ targetTitle: title });
  },
  "android-uiautomator": async ({ subject, base, createOptions, spawnEnv }) => {
    const { AndroidReplayDriver } = await import("../../android/src/replay.js");
    const launchPackage = stringValue(createOptions?.launchPackage);
    if (!launchPackage) {
      throw new WorkflowProvenanceError(
        `android finding ${subject.finding.id} has no durable launch package`,
        "incompatible-target",
      );
    }
    const raw = spawnEnv?.INSPECTOR_ANDROID_BACKEND;
    if (raw !== "mock" && raw !== "real") {
      throw new WorkflowProvenanceError(
        `android finding ${subject.finding.id} lacks durable backend provenance (INSPECTOR_ANDROID_BACKEND='${String(raw)}'); refusing to infer from current host`,
        "incompatible-target",
      );
    }
    const backend = raw as "mock" | "real";
    return new AndroidReplayDriver({
      backend,
      createOptions: { launchPackage },
      launchPackage,
      resetStrategy: "force-stop",
      artifactBaseDir: join(base, "replay", subject.finding.id),
    });
  },
  "electron-chromium": async ({ subject, base, spawnEnv }) => {
    const { ElectronReplayDriver } = await import("../../electron-adapter/src/replay.js");
    const raw = spawnEnv?.INSPECTOR_ELECTRON_BACKEND;
    // H5-D11: durable replay identity must pin the backend mode that produced
    // the evidence. A missing/malformed backend is NOT an excuse to let the
    // driver auto-select `real` or `injectable` from CURRENT-host availability
    // (which would silently reclassify a real finding as injectable, or vice
    // versa). Fail closed with a typed compatibility outcome instead.
    if (raw !== "injectable" && raw !== "real") {
      throw new WorkflowProvenanceError(
        `electron finding ${subject.finding.id} lacks durable backend provenance (INSPECTOR_ELECTRON_BACKEND='${String(raw)}'); refusing to reconstruct replay from current-host capability`,
        "incompatible-target",
      );
    }
    return new ElectronReplayDriver({
      artifactBaseDir: join(base, "replay", subject.finding.id),
      backend: raw,
    });
  },
};

/** Durable adapter identities with platform-faithful replay support. */
export const REPLAY_SUPPORTED_DURABLE_ADAPTERS: readonly string[] = Object.keys(
  REPLAY_DRIVER_FACTORIES,
);

/** Construct the platform-faithful replay driver recorded by the run. */
export async function replayDriverFor(
  subject: LoadedReplaySubject,
  base: string,
): Promise<ReplayDriver> {
  const createOptions = parseRecord(subject.environment.create_options, "create options", subject.finding.id);
  const spawnEnv = parseRecord(subject.environment.spawn_env, "spawn environment", subject.finding.id);
  const adapter = subject.run.adapter;
  const factory = adapter === null ? undefined : REPLAY_DRIVER_FACTORIES[adapter];
  if (factory === undefined) {
    throw new WorkflowProvenanceError(
      `unsupported recorded adapter '${adapter ?? "unknown"}' for finding ${subject.finding.id}`, 
      "incompatible-target",
    );
  }
  return factory({ subject, base, createOptions, spawnEnv });
}

/** Stable idempotency key for one finding/adapter/revision regression scenario. */
export function regressionScenarioKey(
  findingId: string,
  adapter: string,
  revision: string | null,
): string {
  return createHash("sha256")
    .update(`${findingId}\0${adapter}\0${revision ?? "current"}`)
    .digest("hex");
}

function assertBundle(
  value: unknown,
  findingId: string,
  runId: string,
  adapter: string,
): asserts value is EvidenceBundle {
  if (!isRecord(value) || value.schema !== "inspector-evidence/1") {
    throw new WorkflowProvenanceError(`finding ${findingId} evidence is not an Inspector evidence bundle`);
  }
  if (!isRecord(value.finding) || value.finding.id !== findingId || value.finding.runId !== runId) {
    throw new WorkflowProvenanceError(`finding ${findingId} evidence provenance does not match its durable run`);
  }
  if (value.finding.adapter !== null && value.finding.adapter !== undefined && value.finding.adapter !== adapter) {
    throw new WorkflowProvenanceError(`finding ${findingId} evidence targets adapter '${String(value.finding.adapter)}', not '${adapter}'`, "incompatible-target");
  }
  if (!Array.isArray(value.minimizedSteps) || value.minimizedSteps.length === 0) {
    throw new WorkflowProvenanceError(`finding ${findingId} has no minimized reproducer in its evidence bundle`);
  }
  value.minimizedSteps.forEach((action) => assertAction(action, findingId));
  if (!Array.isArray(value.originalSteps)) {
    throw new WorkflowProvenanceError(`finding ${findingId} evidence has no original action path`);
  }
}

function assertAction(value: unknown, findingId: string): asserts value is Action {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.environmentId !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.risk !== "string" ||
    typeof value.deadlineMs !== "number" ||
    !Number.isSafeInteger(value.deadlineMs) ||
    value.deadlineMs < 1 ||
    typeof value.idempotency !== "string"
  ) {
    throw new WorkflowProvenanceError(`finding ${findingId} contains an invalid serialized action`);
  }
}

function parseRecord(raw: string | null, label: string, findingId: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) throw new Error("expected an object");
    return value;
  } catch (err) {
    throw new WorkflowProvenanceError(
      `finding ${findingId} has malformed ${label}: ${errorMessage(err)}`,
    );
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Ensure replay artifact directories exist before an adapter starts. */
export function ensureReplayDir(base: string, findingId: string): string {
  const dir = join(base, "replay", findingId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
