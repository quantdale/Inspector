import {
  DuplicateActionIdempotencyError,
  type Store,
  type ActionRecord,
} from "@inspector/store-sqlite";
import type { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient, stripUrlCredentialsInText } from "@inspector/adapter-sdk";
import {
  PolicyEngine,
  DEFAULT_POLICY,
  type Policy,
  type PolicyDecision,
} from "./policy.js";
import { parseActionOutcome, parseAdapterObservation } from "./validation.js";
import { newId, type ActionOutcomeStatus } from "@inspector/protocol";
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

/** Rebuild the recorded outcome of an already-decided action so a duplicate
 * submission can replay durable truth instead of re-contacting the adapter. */
function outcomeFromRecord(rec: ActionRecord): ActionOutcome {
  const outcome: ActionOutcome = {
    actionId: rec.id,
    runId: rec.run_id,
    environmentId: rec.environment_id,
    status: rec.status as ActionOutcomeStatus,
    observedAt: rec.decided_at ?? rec.requested_at,
  };
  if (rec.state_after) outcome.stateAfter = rec.state_after;
  if (rec.error_json) {
    try {
      outcome.error = JSON.parse(rec.error_json);
    } catch {
      /* unparsable legacy error payload: omit rather than fabricate */
    }
  }
  return outcome;
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
        const payload = JSON.parse(latest.payload_json) as { stepSeq?: number };
        this.stepSeq = payload.stepSeq ?? 0;
      } catch {
        this.stepSeq = 0;
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
    const nextSeq = this.stepSeq + 1;
    const stepId = newId("step");
    this.store.commitObservationStep({
      stepId,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: nextSeq,
      observations: [
        {
          id: this.uniqueObservationId(obs.id || newId("obs")),
          stepId,
          sequence: nextSeq,
          source: obs.source,
          capturedAt: obs.capturedAt,
          summary: obs.summary,
        },
      ],
    });
    // Advance only after the step is durably committed so a failed
    // transaction cannot desynchronize memory from disk.
    this.stepSeq = nextSeq;
    this.checkpoint();
    return obs;
  }

  /**
   * Evaluate policy, then (if allowed) persist a pending action and request the
   * outcome from the adapter. A crash/timeout leaves the action pending so it
   * can be recovered without blind re-submission.
   */
  async submitAction(action: Action): Promise<SubmitResult> {
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
        },
      ],
    });
    this.stepSeq = nextSeq;
    this.engine.recordAction();
    this.accountArtifactBytes(outcome);
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

  /** Charge artifact bytes referenced by a committed outcome against the
   * policy budget. Sizes come from the artifact store's metadata. */
  private accountArtifactBytes(outcome: ActionOutcome): void {
    if (!outcome.artifactRefs?.length) return;
    let bytes = 0;
    for (const ref of outcome.artifactRefs) {
      bytes += this.artifactStore.meta(this.ctx.runId, ref)?.size ?? 0;
    }
    if (bytes > 0) this.engine.recordArtifactBytes(bytes);
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
        env: opts.adapterEnv,
      });
      const caps = (await adapter.request("initialize", {}, opts.initializeTimeoutMs ?? 30000)) as CapabilityDoc;
      await adapter.request(
        "lifecycle",
        opts.createOptions
          ? { op: "create", options: opts.createOptions }
          : { op: "create" },
        30000,
      );
      // Honest identity: the adapter's own initialize answer replaces the
      // command-derived provisional label in the durable records.
      this.store.recordAdapterIdentity(runId, envId, caps.adapter);
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
    let createRequest: { op: string; options?: Record<string, unknown> } = { op: "create" };
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
        createRequest = { op: "create", options: parsed as Record<string, unknown> };
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
        env: spawnEnv,
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
