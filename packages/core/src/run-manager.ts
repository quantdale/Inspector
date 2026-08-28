import {
  DuplicateActionIdempotencyError,
  type Store,
  type ActionRecord,
} from "@inspector/store-sqlite";
import type { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, stripUrlCredentialsInText } from "@inspector/adapter-sdk";
import { resolve } from "node:path";
import {
  PolicyEngine,
  DEFAULT_POLICY,
  type Policy,
  type PolicyDecision,
} from "./policy.js";
import { parseActionOutcome, parseAdapterObservation } from "./validation.js";
import { newId, ProtocolError, type ActionOutcomeStatus } from "@inspector/protocol";
import type {
  Action,
  Observation,
  ActionOutcome,
  CapabilityDoc,
} from "@inspector/protocol";

export interface StartRunOptions {
  adapterCommand: string;
  adapterArgs?: string[];
  adapterEnv?: NodeJS.ProcessEnv;
  policy?: Policy;
  artifactBaseDir?: string;
  /** Optional lifecycle-create options forwarded verbatim to the adapter
   * (e.g. `{ targetUrl }` for the web adapter's external-target mode). */
  createOptions?: Record<string, unknown>;
  /** The spawn-env DELTA (over process.env) the adapter needs — e.g.
   * `WEB_TARGET_URL`. Persisted (credential-stripped) so a resume on a fresh
   * process can re-create the SAME environment, never silently retargeting. */
  spawnEnvDelta?: NodeJS.ProcessEnv;
  /** Per-observe deadline override (ms); see RunControllerContext. */
  observeTimeoutMs?: number;
  /** Adapter startup deadline. Browser/device adapters can take longer than
   * the ordinary request default while launching their host process. */
  initializeTimeoutMs?: number;
  /** Immutable product-level campaign configuration, if this is an explorer run. */
  runMeta?: unknown;
  /** Durable explorer identity/configuration registered before adapter startup. */
  exploration?: {
    schemaVersion: number;
    explorerKind: string;
    explorerVersion: string;
    adapter?: string;
    config: unknown;
  };
}

export type SubmitResult =
  | { kind: "rejected"; decision: PolicyDecision }
  | { kind: "outcome"; outcome: ActionOutcome }
  | { kind: "adapter-error"; error: string }
  /** The action is already durably known and its outcome is unresolved;
   * it must be re-observed, never blindly resent. */
  | { kind: "duplicate"; action: ActionRecord };

export interface RunControllerContext {
  runId: string;
  envId: string;
  adapter: AdapterClient;
  caps: CapabilityDoc;
  /** Per-observe deadline (ms). Default 10000; real-device adapters
   * (uiautomator dumps, UIA subtree walks) legitimately need more. */
  observeTimeoutMs?: number;
}

/** Provisional adapter label derived from the spawn command; replaced by the
 * adapter's self-reported identity once initialize answers. */
function adapterLabel(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? "";
  return base.length > 0 ? base : "unknown";
}

function assertActionContext(action: Action, runId: string, environmentId: string): void {
  if (action.runId !== runId || action.environmentId !== environmentId) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `action ${action.id} is not attributed to the current run/environment`,
      detail: {
        action: { runId: action.runId, environmentId: action.environmentId },
        controller: { runId, environmentId },
      },
    });
  }
}

function assertOutcomeContext(
  outcome: ActionOutcome,
  action: Action,
  runId: string,
  environmentId: string,
): void {
  if (
    outcome.actionId !== action.id ||
    outcome.runId !== runId ||
    outcome.environmentId !== environmentId
  ) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `adapter outcome is not correlated to action ${action.id} and current run/environment`,
      detail: {
        expected: { actionId: action.id, runId, environmentId },
        received: {
          actionId: outcome.actionId,
          runId: outcome.runId,
          environmentId: outcome.environmentId,
        },
      },
    });
  }
}

function assertObservationContext(
  observation: Observation,
  runId: string,
  environmentId: string,
): void {
  if (observation.runId !== runId || observation.environmentId !== environmentId) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: "adapter observation is not correlated to the current run/environment",
      detail: {
        expected: { runId, environmentId },
        received: { runId: observation.runId, environmentId: observation.environmentId },
      },
    });
  }
}

/** Rebuild the recorded outcome of an already-decided action so a duplicate
 * submission can replay durable truth instead of re-contacting the adapter. */
function outcomeFromRecord(rec: ActionRecord): ActionOutcome {
  if (rec.status === "pending" || !rec.decided_at) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `durable action ${rec.id} is missing a decided outcome`,
      detail: { status: rec.status, decidedAt: rec.decided_at },
    });
  }
  if ((rec.error_code === null) !== (rec.error_json === null)) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `durable action ${rec.id} has inconsistent error evidence columns`,
      detail: { errorCode: rec.error_code, hasErrorJson: rec.error_json !== null },
    });
  }
  const outcome: ActionOutcome = {
    actionId: rec.id,
    runId: rec.run_id,
    environmentId: rec.environment_id,
    status: rec.status as ActionOutcomeStatus,
    observedAt: rec.decided_at,
  };
  if (rec.state_after) outcome.stateAfter = rec.state_after;
  if (rec.error_json) {
    try {
      outcome.error = JSON.parse(rec.error_json);
    } catch (err) {
      throw new ProtocolError({
        code: "VALIDATION",
        message: `durable action ${rec.id} carries malformed error evidence`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const validated = parseActionOutcome(outcome);
  if (rec.error_code !== null && validated.error?.code !== rec.error_code) {
    throw new ProtocolError({
      code: "VALIDATION",
      message: `durable action ${rec.id} has mismatched error code evidence`,
      detail: { errorCode: rec.error_code, error: validated.error },
    });
  }
  return validated;
}

/**
 * Drives a single run: policy enforcement, adapter communication, durable
 * step commit, checkpointing, and crash recovery.
 */
export class RunController {
  private stepSeq = 0;
  readonly caps: CapabilityDoc;

  constructor(
    private readonly store: Store,
    private readonly artifactStore: ArtifactStore,
    private readonly engine: PolicyEngine,
    private readonly ctx: RunControllerContext,
  ) {
    this.caps = ctx.caps;
    const latest = store.getLatestCheckpoint(ctx.runId);
    if (latest) {
      try {
        const payload = JSON.parse(latest.payload_json) as unknown;
        if (
          payload === null ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          typeof (payload as { stepSeq?: unknown }).stepSeq !== "number" ||
          !Number.isSafeInteger((payload as { stepSeq: number }).stepSeq) ||
          (payload as { stepSeq: number }).stepSeq < 0
        ) {
          throw new Error("checkpoint stepSeq must be a non-negative safe integer");
        }
        this.stepSeq = (payload as { stepSeq: number }).stepSeq;
      } catch (err) {
        throw new ProtocolError({
          code: "VALIDATION",
          message: `durable checkpoint ${latest.id} is malformed; refusing to resume`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Sequence numbers are monotonic per run across restarts. The checkpoint
    // is written AFTER each step commits, so a hard kill between the two
    // leaves the checkpoint lagging the durable step table; trusting it alone
    // would reuse an occupied sequence and violate UNIQUE(run_id, sequence)
    // on the resumed run's first observation (observed as resume failures on
    // Windows). The step table is authoritative for the floor.
    const persistedMax = store.maxRunStepSequence(ctx.runId);
    if (persistedMax > this.stepSeq) this.stepSeq = persistedMax;
    // Budgets survive restarts: a fresh engine must inherit the durable
    // action count instead of starting from zero.
    this.engine.seedActionCount(store.countRunActions(ctx.runId));
    this.engine.seedResetCount(store.countExplorationEvents(ctx.runId, "reset"));
    this.engine.seedArtifactBytes(store.sumRunArtifactBytes(ctx.runId));
  }

  get runId(): string {
    return this.ctx.runId;
  }
  get environmentId(): string {
    return this.ctx.envId;
  }

  async observe(observe: string[]): Promise<Observation> {
    // ADR 0002: validate before persisting; malformed payloads never touch
    // durable state or consume a sequence number.
    const obs = parseAdapterObservation(
      await this.ctx.adapter.request(
        "observe",
        { observe },
        this.ctx.observeTimeoutMs ?? 10000,
      ),
    );
    assertObservationContext(obs, this.ctx.runId, this.ctx.envId);
    const nextSeq = this.stepSeq + 1;
    const stepId = newId("step");
    const observationArtifacts = this.resolveObservationArtifacts(obs.artifacts ?? []);
    const canonicalObservation: Observation = {
      ...obs,
      id: this.uniqueObservationId(obs.id || newId("obs")),
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      // Adapter sequence/step fields are descriptive only. The controller
      // owns durable step attribution and returns the canonical form.
      sequence: nextSeq,
      stepId,
      artifacts: observationArtifacts,
    };
    this.store.commitObservationStep({
      stepId,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: nextSeq,
      observations: [
        {
          id: canonicalObservation.id,
          stepId,
          sequence: nextSeq,
          source: canonicalObservation.source,
          capturedAt: canonicalObservation.capturedAt,
          summary: canonicalObservation.summary,
          artifacts: observationArtifacts,
        },
      ],
    });
    // Advance only after the step is durably committed so a failed
    // transaction cannot desynchronize memory from disk.
    this.stepSeq = nextSeq;
    this.checkpoint();
    return canonicalObservation;
  }

  /**
   * Evaluate policy, then (if allowed) persist a pending action and request the
   * outcome from the adapter. A crash/timeout leaves the action pending so it
   * can be recovered without blind re-submission.
   */
  async submitAction(action: Action): Promise<SubmitResult> {
    assertActionContext(action, this.ctx.runId, this.ctx.envId);
    const decision = this.engine.evaluate(action);
    if (!decision.allowed) {
      return { kind: "rejected", decision };
    }

    // Idempotent admission: resubmitting a known action never crashes on the
    // primary key and never blindly resends an unresolved request.
    let admission: ReturnType<Store["insertPendingAction"]>;
    try {
      admission = this.store.insertPendingAction({
        id: action.id,
        runId: this.ctx.runId,
        environmentId: this.ctx.envId,
        kind: action.kind,
        risk: action.risk,
        deadlineMs: action.deadlineMs,
        idempotency: action.idempotency,
        metadata: { input: action.input ?? null, metadata: action.metadata ?? null },
      });
    } catch (err) {
      if (!(err instanceof DuplicateActionIdempotencyError)) throw err;
      const unresolved = this.store
        .getInFlightActions(this.ctx.runId)
        .find((candidate) => candidate.idempotency === action.idempotency);
      if (!unresolved) throw err;
      return { kind: "duplicate", action: unresolved };
    }
    if (!admission.inserted) {
      const existing = admission.existing!;
      if (existing.status === "pending" || existing.status === "unknown") {
        return { kind: "duplicate", action: existing };
      }
      return { kind: "outcome", outcome: outcomeFromRecord(existing) };
    }

    let rawOutcome: unknown;
    try {
      rawOutcome = await this.ctx.adapter.request(
        "act",
        { action },
        action.deadlineMs,
      );
    } catch (err) {
      // Adapter crash / deadline exceeded: leave the action pending for recovery.
      this.checkpoint();
      return {
        kind: "adapter-error",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ADR 0002: validate the outcome before any persistence; on failure the
    // action stays pending (recoverable) and no partial step is written.
    const outcome = parseActionOutcome(rawOutcome);
    assertOutcomeContext(outcome, action, this.ctx.runId, this.ctx.envId);
    const outcomeArtifacts = this.resolveActionArtifacts(outcome.artifactRefs ?? []);

    const nextSeq = this.stepSeq + 1;
    const stepId = newId("step");
    this.store.commitStep({
      stepId,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: nextSeq,
      action: {
        id: action.id,
        kind: action.kind,
        risk: action.risk,
        deadlineMs: action.deadlineMs,
        idempotency: action.idempotency,
        status: outcome.status,
        stateAfter: outcome.stateAfter ?? null,
        errorCode: outcome.error?.code ?? null,
        error: outcome.error ?? null,
        metadata: { input: action.input ?? null, metadata: action.metadata ?? null },
      },
      observations: [
        {
          id: newId("obs"),
          stepId,
          sequence: nextSeq,
          source: this.ctx.caps.adapter,
          capturedAt: outcome.observedAt,
          summary: { stateAfter: outcome.stateAfter, status: outcome.status },
          artifacts: outcomeArtifacts,
        },
      ],
    });
    this.stepSeq = nextSeq;
    this.engine.recordAction();
    this.accountArtifactBytes(outcomeArtifacts);
    this.checkpoint();
    return { kind: "outcome", outcome };
  }

  async reset(): Promise<void> {
    const budget = this.engine.recordReset();
    if (!budget.allowed) {
      throw new Error(budget.reason ?? "environment reset budget exhausted");
    }
    await this.ctx.adapter.request("lifecycle", { op: "reset" }, 10000);
    await this.observe(["state"]);
  }

  /** Regenerate a deterministic, pattern-valid observation id when the
   * adapter supplied one that is already persisted; external data must not be
   * able to abort the step transaction via a primary-key collision. */
  private uniqueObservationId(preferred: string): string {
    if (!this.store.observationExists(preferred)) return preferred;
    const base = preferred.slice(0, 120);
    for (let n = 1; ; n++) {
      const candidate = `${base}-r${n}`;
      if (!this.store.observationExists(candidate)) return candidate;
    }
  }

  /** Charge bytes from the already-validated artifact metadata. */
  private accountArtifactBytes(artifacts: Array<{ size: number }>): void {
    const bytes = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
    if (bytes > 0) this.engine.recordArtifactBytes(bytes);
  }

  private resolveActionArtifacts(
    refs: readonly string[],
  ): Array<{ sha256: string; mime: string; size: number; path: string }> {
    const seen = new Set<string>();
    const resolved: Array<{ sha256: string; mime: string; size: number; path: string }> = [];
    for (const sha256 of refs) {
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      const meta = this.requireArtifact(sha256);
      resolved.push({
        sha256: meta.sha256,
        mime: meta.mime,
        size: meta.size,
        path: meta.path,
      });
    }
    return resolved;
  }

  private resolveObservationArtifacts(
    refs: NonNullable<Observation["artifacts"]>,
  ): NonNullable<Observation["artifacts"]> {
    const seen = new Set<string>();
    const resolved: NonNullable<Observation["artifacts"]> = [];
    for (const ref of refs) {
      if (seen.has(ref.sha256)) continue;
      seen.add(ref.sha256);
      const meta = this.requireArtifact(ref.sha256);
      if (meta.size !== ref.size || resolve(meta.path) !== resolve(ref.path)) {
        throw new ProtocolError({
          code: "VALIDATION",
          message: `observation artifact metadata mismatch for ${ref.sha256}`,
          detail: { declared: ref, stored: meta },
        });
      }
      resolved.push({
        sha256: meta.sha256,
        mime: ref.mime,
        size: meta.size,
        path: meta.path,
      });
    }
    return resolved;
  }

  private requireArtifact(sha256: string) {
    try {
      const meta = this.artifactStore.meta(this.ctx.runId, sha256);
      if (!meta) throw new Error("artifact is missing");
      this.artifactStore.verifyStrict(this.ctx.runId, sha256);
      return meta;
    } catch (err) {
      throw new ProtocolError({
        code: "VALIDATION",
        message: `declared artifact ${sha256} is not valid evidence for run ${this.ctx.runId}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private checkpoint(): void {
    this.store.writeCheckpoint({
      id: newId("ckpt"),
      runId: this.ctx.runId,
      payload: { stepSeq: this.stepSeq },
    });
  }

  async close(): Promise<void> {
    // Teardown problems are recorded honestly instead of being masked by a
    // clean 'closed' status; close() itself stays non-throwing so callers
    // cannot leak the subprocess by skipping a catch.
    let teardownError: unknown = null;
    try {
      await this.ctx.adapter.request("lifecycle", { op: "close" }, 5000);
    } catch (err) {
      teardownError = err;
    }
    try {
      await this.ctx.adapter.close();
    } catch (err) {
      teardownError = teardownError ?? err;
    }
    this.engine.closeEnvironment();
    if (teardownError) {
      this.store.setEnvironmentStatus(this.ctx.envId, "crashed");
      this.store.setRunStatus(this.ctx.runId, "failed");
      this.store.setExplorationCampaignStatus(this.ctx.runId, "failed");
    } else {
      this.store.setEnvironmentStatus(this.ctx.envId, "closed");
      this.store.setRunStatus(this.ctx.runId, "closed");
      this.store.setExplorationCampaignStatus(this.ctx.runId, "closed");
    }
  }
}

export class RunManager {
  constructor(
    private readonly store: Store,
    private readonly artifactStore: ArtifactStore,
    private readonly engine: PolicyEngine = new PolicyEngine(DEFAULT_POLICY),
  ) {}

  private adapterEnv(
    supplied: NodeJS.ProcessEnv | undefined,
    requestedArtifactBaseDir: string | undefined,
  ): NodeJS.ProcessEnv {
    const canonical = resolve(this.artifactStore.baseDir);
    const requested = requestedArtifactBaseDir === undefined
      ? undefined
      : resolve(requestedArtifactBaseDir);
    const sameBase = requested === undefined || (process.platform === "win32"
      ? requested.toLowerCase() === canonical.toLowerCase()
      : requested === canonical);
    if (!sameBase) {
      throw new Error(
        `artifactBaseDir must match the controller artifact store (${canonical})`,
      );
    }
    return {
      ...(supplied ?? process.env),
      // The controller is the authority for evidence ownership. Do not allow
      // caller-supplied adapter env to silently point at another store.
      INSPECTOR_ARTIFACT_BASE_DIR: canonical,
    };
  }

  async startRun(opts: StartRunOptions): Promise<RunController> {
    const runId = newId("run");
    const envId = newId("env");
    const provisional = adapterLabel(opts.adapterCommand);
    this.store.createRun({
      id: runId,
      adapter: provisional,
      ...(opts.runMeta !== undefined ? { meta: opts.runMeta } : {}),
    });
    this.store.createEnvironment({
      id: envId,
      runId,
      adapter: provisional,
      ...(opts.createOptions ? { createOptions: opts.createOptions } : {}),
      ...(opts.spawnEnvDelta
        ? {
            spawnEnv: Object.fromEntries(
              Object.entries(opts.spawnEnvDelta).map(([k, v]) => [
                k,
                typeof v === "string" ? stripUrlCredentialsInText(v) : v,
              ]),
            ),
          }
        : {}),
    });
    if (opts.exploration) {
      this.store.createExplorationCampaign({
        runId,
        schemaVersion: opts.exploration.schemaVersion,
        explorerKind: opts.exploration.explorerKind,
        explorerVersion: opts.exploration.explorerVersion,
        adapter: opts.exploration.adapter ?? provisional,
        config: opts.exploration.config,
      });
    }
    const opened = this.engine.openEnvironment();
    if (!opened.allowed) {
      this.store.setRunStatus(runId, "failed");
      this.store.setEnvironmentStatus(envId, "failed");
      this.store.setExplorationCampaignStatus(runId, "failed");
      throw new Error(
        opened.reason ?? "environment concurrency budget exceeded",
      );
    }
    let adapter: AdapterClient | null = null;
    try {
      adapter = await AdapterClient.spawn({
        command: opts.adapterCommand,
        args: opts.adapterArgs,
        env: this.adapterEnv(opts.adapterEnv, opts.artifactBaseDir),
      });
      const caps = (await adapter.request("initialize", {}, opts.initializeTimeoutMs ?? 30000)) as CapabilityDoc;
      // Honest identity: the adapter's own initialize answer replaces the
      // command-derived provisional label in the durable records. Recorded
      // BEFORE lifecycle create so an environment that fails to start still
      // carries its true adapter family, never the runner's executable name
      // (HARDENING_5 H5-D2).
      this.store.recordAdapterIdentity(runId, envId, caps.adapter);
      await adapter.request(
        "lifecycle",
        {
          op: "create",
          options: {
            ...(opts.createOptions ?? {}),
            runId,
            environmentId: envId,
          },
        },
        30000,
      );
      this.store.setRunStatus(runId, "running");
      return new RunController(this.store, this.artifactStore, this.engine, {
        runId,
        envId,
        adapter,
        caps,
        ...(opts.observeTimeoutMs !== undefined
          ? { observeTimeoutMs: opts.observeTimeoutMs }
          : {}),
      });
    } catch (err) {
      // Guaranteed cleanup: never orphan the subprocess, leak the environment
      // counter, or strand the run at 'created'.
      if (adapter) await adapter.close().catch(() => {});
      this.engine.closeEnvironment();
      this.store.setRunStatus(runId, "failed");
      this.store.setEnvironmentStatus(envId, "failed");
      this.store.setExplorationCampaignStatus(runId, "failed");
      throw err;
    }
  }

  /**
   * Reopen an existing run on a new process: re-establish the adapter, mark any
   * in-flight actions `unknown`, and re-observe rather than blindly resubmit.
   */
  async resumeRun(
    runId: string,
    opts: {
      adapterCommand: string;
      adapterArgs?: string[];
      adapterEnv?: NodeJS.ProcessEnv;
      observeTimeoutMs?: number;
      initializeTimeoutMs?: number;
    },
  ): Promise<RunController> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    const hasRecoverableInFlight = this.store.getInFlightActions(runId).length > 0;
    if (
      ["closed", "complete", "resolved"].includes(run.status) ||
      (["failed", "crashed"].includes(run.status) && !hasRecoverableInFlight)
    ) {
      throw new Error(`run ${runId} is already terminal (${run.status}); refusing to resume`);
    }
    const env = this.store.getEnvironmentForRun(runId);
    if (!env) throw new Error(`no environment for run: ${runId}`);
    // Durable resume spec (persisted by startRun): without it a fresh adapter
    // process would observe an environment that was never created, and a
    // targeted web run would silently fall back to its default target.
    let spawnEnv = opts.adapterEnv;
    let createRequest: { op: string; options?: Record<string, unknown> } = {
      op: "create",
      options: { runId, environmentId: env.id },
    };
    if (env.spawn_env) {
      try {
        const parsed = JSON.parse(env.spawn_env) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("spawn-env resume spec is not an object");
        }
        spawnEnv = { ...(opts.adapterEnv ?? process.env), ...(parsed as NodeJS.ProcessEnv) };
      } catch {
        throw new Error(`run ${runId} has a malformed durable adapter spawn-env spec; refusing to guess`);
      }
    }
    if (env.create_options) {
      try {
        const parsed = JSON.parse(env.create_options) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("create-options resume spec is not an object");
        }
        createRequest = {
          op: "create",
          options: {
            ...(parsed as Record<string, unknown>),
            runId,
            environmentId: env.id,
          },
        };
      } catch {
        throw new Error(`run ${runId} has malformed durable adapter create options; refusing to guess`);
      }
    }
    const opened = this.engine.openEnvironment();
    if (!opened.allowed) {
      throw new Error(
        opened.reason ?? "environment concurrency budget exceeded",
      );
    }
    let adapter: AdapterClient | null = null;
    try {
      adapter = await AdapterClient.spawn({
        command: opts.adapterCommand,
        args: opts.adapterArgs,
        env: this.adapterEnv(spawnEnv, undefined),
      });
      const caps = (await adapter.request("initialize", {}, opts.initializeTimeoutMs ?? 30000)) as CapabilityDoc;
      const expectedAdapter = env.adapter || run.adapter;
      if (
        expectedAdapter &&
        !["node", "tsx", "unknown", "adapter-fake"].includes(expectedAdapter) &&
        caps.adapter !== expectedAdapter
      ) {
        throw new Error(
          `adapter provenance mismatch while resuming ${runId}: expected '${expectedAdapter}', got '${caps.adapter}'`,
        );
      }
      // Re-create the environment on the fresh process. The original
      // environment died with the old host; re-observation below must hit a
      // LIVE environment, so "resume" means faithful re-creation, not a no-op.
      await adapter.request("lifecycle", createRequest, 30000);
      const controller = new RunController(
        this.store,
        this.artifactStore,
        this.engine,
        {
          runId,
          envId: env.id,
          adapter,
          caps,
          ...(opts.observeTimeoutMs !== undefined
            ? { observeTimeoutMs: opts.observeTimeoutMs }
            : {}),
        },
      );
      this.store.setRunStatus(runId, "running");
      this.store.setEnvironmentStatus(env.id, "running");
      this.store.setExplorationCampaignStatus(runId, "running");
      const inFlight = this.store.markInFlightUnknown(runId);
      for (let i = 0; i < inFlight.length; i++) {
        await controller.observe(["state"]);
      }
      return controller;
    } catch (err) {
      if (adapter) await adapter.close().catch(() => {});
      this.engine.closeEnvironment();
      this.store.setEnvironmentStatus(env.id, "failed");
      throw err;
    }
  }
}
