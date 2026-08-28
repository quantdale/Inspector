import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import {
  PROTOCOL_VERSION,
  type CapabilityDoc,
  type Observation,
  type ActionOutcome,
  type Action,
  type HealthResponse,
} from "@inspector/protocol";
import { ArtifactStore, type ArtifactMetadata } from "@inspector/artifact-store";
import { AdapterHandler } from "@inspector/adapter-sdk";
import { FakeStateMachine } from "./state-machine.js";

export const FAKE_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "adapter-fake",
  capabilities: {
    observe: ["uiTree", "state"],
    act: [
      "openForm",
      "fillField",
      "submit",
      "retry",
      "goHome",
      "toggleFlag",
      "createArtifact",
      "reset",
    ],
    lifecycle: ["create", "reset", "close"],
    faults: ["timeout", "crash"],
    coverage: [],
  },
};

export interface FakeFaults {
  crashActionId?: string;
  timeoutActionIds?: string[];
  timeoutMs?: number;
}

export interface FakeHandlerOptions {
  faults?: FakeFaults;
  artifactBaseDir?: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeAdapterHandler implements AdapterHandler {
  private readonly sm = new FakeStateMachine();
  private readonly faults: FakeFaults;
  private readonly artifactStore: ArtifactStore;
  private runId = "run";
  private environmentId = "env";
  private sequence = 0;
  private readonly startTime = Date.now();

  constructor(opts: FakeHandlerOptions = {}) {
    this.faults = opts.faults ?? {};
    const base = opts.artifactBaseDir ?? join(tmpdir(), "inspector-fake-artifacts");
    mkdirSync(base, { recursive: true });
    this.artifactStore = new ArtifactStore(base);
  }

  async initialize(): Promise<CapabilityDoc> {
    return FAKE_CAPABILITIES;
  }

  async observe(params: { observe?: string[] }): Promise<Observation> {
    const summary = this.sm.snapshot();
    if (params.observe?.includes("uiTree")) {
      summary.uiTree = [{ role: "button", name: "submit" }];
    }
    return {
      id: `obs_${this.sequence}`,
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.sequence++,
      source: "adapter-fake",
      capturedAt: new Date().toISOString(),
      summary,
    };
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    const action = params.action;
    if (this.faults.crashActionId && action.id === this.faults.crashActionId) {
      // Real injected adapter crash: the process dies before responding.
      process.exit(1);
    }
    if (this.faults.timeoutActionIds?.includes(action.id)) {
      await delay(this.faults.timeoutMs ?? 30000);
    }
    const result = this.sm.apply({ kind: action.kind, input: action.input });
    const artifactRefs: string[] = [];
    if (action.kind === "createArtifact") {
      const stub = Buffer.from(`artifact stub for ${action.id}`);
      const meta: ArtifactMetadata = this.artifactStore.write({
        runId: action.runId,
        content: stub,
        mime: "application/octet-stream",
        name: `stub-${action.id}`,
      });
      artifactRefs.push(meta.sha256);
    }
    const outcome: ActionOutcome = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      status: result.status === "target-failure" ? "target-failure" : "success",
      observedAt: new Date().toISOString(),
      stateAfter: result.nextState,
      artifactRefs,
    };
    if (result.status === "target-failure") {
      outcome.error = {
        code: "TARGET_FAILURE",
        message: result.oracleSignal ?? "deterministic oracle failure",
        detail: result.summary,
      };
    }
    return outcome;
  }

  async lifecycle(params: { op: string; options?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    if (params.op === "create") {
      const runId = params.options?.runId;
      const environmentId = params.options?.environmentId;
      if (typeof runId === "string" && runId) this.runId = runId;
      if (typeof environmentId === "string" && environmentId) this.environmentId = environmentId;
    }
    if (params.op === "reset") this.sm.reset();
    return { ok: true };
  }

  async health(params: { echo?: string }): Promise<HealthResponse> {
    return {
      ok: true,
      echo: params.echo,
      uptimeMs: Date.now() - this.startTime,
      now: new Date().toISOString(),
    };
  }

  async cancel(): Promise<void> {
    /* best-effort: fake adapter does not support interruption */
  }

  stubHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
