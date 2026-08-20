import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { AdapterClient } from "@inspector/adapter-sdk";
import { PolicyEngine, DEFAULT_POLICY, type Policy, type PolicyDecision } from "./policy.js";
import { newId } from "@inspector/protocol";
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
}

export type SubmitResult =
  | { kind: "rejected"; decision: PolicyDecision }
  | { kind: "outcome"; outcome: ActionOutcome }
  | { kind: "adapter-error"; error: string };

export interface RunControllerContext {
  runId: string;
  envId: string;
  adapter: AdapterClient;
  caps: CapabilityDoc;
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
  }

  get runId(): string {
    return this.ctx.runId;
  }
  get environmentId(): string {
    return this.ctx.envId;
  }

  async observe(observe: string[]): Promise<Observation> {
    const obs = (await this.ctx.adapter.request("observe", { observe }, 10000)) as Observation;
    this.stepSeq += 1;
    this.store.commitObservationStep({
      stepId: newId("step"),
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: this.stepSeq,
      observations: [
        {
          id: obs.id || newId("obs"),
          stepId: null,
          sequence: this.stepSeq,
          source: obs.source,
          capturedAt: obs.capturedAt,
          summary: obs.summary,
        },
      ],
    });
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
    this.store.insertPendingAction({
      id: action.id,
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      kind: action.kind,
      risk: action.risk,
      deadlineMs: action.deadlineMs,
      idempotency: action.idempotency,
    });

    let outcome: ActionOutcome;
    try {
      outcome = (await this.ctx.adapter.request("act", { action }, action.deadlineMs)) as ActionOutcome;
    } catch (err) {
      // Adapter crash / deadline exceeded: leave the action pending for recovery.
      this.checkpoint();
      return { kind: "adapter-error", error: err instanceof Error ? err.message : String(err) };
    }

    this.stepSeq += 1;
    this.store.commitStep({
      stepId: newId("step"),
      runId: this.ctx.runId,
      environmentId: this.ctx.envId,
      sequence: this.stepSeq,
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
          stepId: null,
          sequence: this.stepSeq,
          source: "adapter-fake",
          capturedAt: outcome.observedAt,
          summary: { stateAfter: outcome.stateAfter, status: outcome.status },
        },
      ],
    });
    this.engine.recordAction();
    this.checkpoint();
    return { kind: "outcome", outcome };
  }

  async reset(): Promise<void> {
    await this.ctx.adapter.request("lifecycle", { op: "reset" }, 10000);
    this.engine.recordReset();
    await this.observe(["state"]);
  }

  private checkpoint(): void {
    this.store.writeCheckpoint({
      id: newId("ckpt"),
      runId: this.ctx.runId,
      payload: { stepSeq: this.stepSeq },
    });
  }

  async close(): Promise<void> {
    try {
      await this.ctx.adapter.request("lifecycle", { op: "close" }, 5000);
    } catch {
      /* ignore */
    }
    await this.ctx.adapter.close();
    this.engine.closeEnvironment();
    this.store.setRunStatus(this.ctx.runId, "closed");
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
    this.store.createRun({ id: runId, adapter: "adapter-fake" });
    this.store.createEnvironment({ id: envId, runId, adapter: "adapter-fake" });
    this.engine.openEnvironment();
    const adapter = await AdapterClient.spawn({
      command: opts.adapterCommand,
      args: opts.adapterArgs,
      env: opts.adapterEnv,
    });
    const caps = (await adapter.request("initialize", {})) as CapabilityDoc;
    return new RunController(this.store, this.artifactStore, this.engine, {
      runId,
      envId,
      adapter,
      caps,
    });
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
    this.engine.openEnvironment();
    const adapter = await AdapterClient.spawn({
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
  }
}
