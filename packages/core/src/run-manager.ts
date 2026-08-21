import { Store, type ActionRecord } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient } from "@inspector/adapter-sdk";
import { PolicyEngine, DEFAULT_POLICY, type Policy, type PolicyDecision } from "./policy.js";
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
    // Budgets survive restarts: a fresh engine must inherit the durable
    // action count instead of starting from zero.
    this.engine.seedActionCount(store.countRunActions(ctx.runId));
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
      await this.ctx.adapter.request("observe", { observe }, 10000),
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
    const admission = this.store.insertPendingAction({
      id: action.id,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      kind: action.kind,
      risk: action.risk,
      deadlineMs: action.deadlineMs,
      idempotency: action.idempotency,
    });
    if (!admission.inserted) {
      const existing = admission.existing!;
      if (existing.status === "pending" || existing.status === "unknown") {
        return { kind: "duplicate", action: existing };
      }
      return { kind: "outcome", outcome: outcomeFromRecord(existing) };
    }

    let rawOutcome: unknown;
    try {
      rawOutcome = await this.ctx.adapter.request("act", { action }, action.deadlineMs);
    } catch (err) {
      // Adapter crash / deadline exceeded: leave the action pending for recovery.
      this.checkpoint();
      return { kind: "adapter-error", error: err instanceof Error ? err.message : String(err) };
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
    await this.ctx.adapter.request("lifecycle", { op: "reset" }, 10000);
    this.engine.recordReset();
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
    } else {
      this.store.setEnvironmentStatus(this.ctx.envId, "closed");
      this.store.setRunStatus(this.ctx.runId, "closed");
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
    this.store.createRun({ id: runId, adapter: provisional });
    this.store.createEnvironment({ id: envId, runId, adapter: provisional });
    const opened = this.engine.openEnvironment();
    if (!opened.allowed) {
      this.store.setRunStatus(runId, "failed");
      this.store.setEnvironmentStatus(envId, "failed");
      throw new Error(opened.reason ?? "environment concurrency budget exceeded");
    }
    let adapter: AdapterClient | null = null;
    try {
      adapter = await AdapterClient.spawn({
        command: opts.adapterCommand,
        args: opts.adapterArgs,
        env: opts.adapterEnv,
      });
      const caps = (await adapter.request("initialize", {})) as CapabilityDoc;
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
      return new RunController(this.store, this.artifactStore, this.engine, {
        runId,
        envId,
        adapter,
        caps,
      });
    } catch (err) {
      // Guaranteed cleanup: never orphan the subprocess, leak the environment
      // counter, or strand the run at 'created'.
      if (adapter) await adapter.close().catch(() => {});
      this.engine.closeEnvironment();
      this.store.setRunStatus(runId, "failed");
      this.store.setEnvironmentStatus(envId, "failed");
      throw err;
    }
  }

  /**
   * Reopen an existing run on a new process: re-establish the adapter, mark any
   * in-flight actions `unknown`, and re-observe rather than blindly resubmit.
   */
  async resumeRun(
    runId: string,
    opts: { adapterCommand: string; adapterArgs?: string[]; adapterEnv?: NodeJS.ProcessEnv },
  ): Promise<RunController> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    const env = this.store.raw
      .prepare(`SELECT * FROM environments WHERE run_id = ? LIMIT 1`)
      .get(runId) as { id: string } | undefined;
    if (!env) throw new Error(`no environment for run: ${runId}`);
    const opened = this.engine.openEnvironment();
    if (!opened.allowed) {
      throw new Error(opened.reason ?? "environment concurrency budget exceeded");
    }
    let adapter: AdapterClient | null = null;
    try {
      adapter = await AdapterClient.spawn({
        command: opts.adapterCommand,
        args: opts.adapterArgs,
        env: opts.adapterEnv,
      });
      const caps = (await adapter.request("initialize", {})) as CapabilityDoc;
      const controller = new RunController(this.store, this.artifactStore, this.engine, {
        runId,
        envId: env.id,
        adapter,
        caps,
      });
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
