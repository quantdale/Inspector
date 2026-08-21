import {
  PROTOCOL_VERSION,
  newId,
  protocolError,
  type CapabilityDoc,
  type Observation,
  type ActionOutcome,
  type Action,
  type HealthResponse,
} from "@inspector/protocol";
import { AdapterCrashError, type AdapterHandler } from "@inspector/adapter-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { ArtifactStore } from "@inspector/artifact-store";
import type { PtyBackend } from "./types.js";

export const CLI_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "cli-pty",
  capabilities: {
    observe: ["uiTree"],
    act: ["fill", "press", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
  },
};

/**
 * CLI/PTY adapter (M6 subphase 1). Terminal interaction is modeled as line
 * entries (fill = submit a command line) over an injectable PTY backend.
 */
export class CliAdapterHandler implements AdapterHandler {
  private sessionId: string | null = null;
  private readonly artifacts: ArtifactStore;
  private seq = 0;

  constructor(
    private readonly backend: PtyBackend,
    artifactBaseDir: string = join(tmpdir(), "inspector-cli-artifacts"),
  ) {
    mkdtempSync(artifactBaseDir);
    this.artifacts = new ArtifactStore(artifactBaseDir);
    void this.artifacts;
  }

  async initialize(): Promise<CapabilityDoc> {
    return CLI_CAPABILITIES;
  }

  async lifecycle(params: { op: string }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create":
      case "reset": {
        if (this.sessionId) await this.backend.kill(this.sessionId).catch(() => undefined);
        const session = await this.backend.spawn("seedcli");
        this.sessionId = session.id;
        return { ok: true };
      }
      case "close": {
        if (this.sessionId) await this.backend.kill(this.sessionId).catch(() => undefined);
        this.sessionId = null;
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  }

  async observe(params: { observe?: string[] } = {}): Promise<Observation> {
    if (!this.sessionId) throw new Error("environment not created");
    void params;
    const screen = await this.backend.readScreen(this.sessionId);
    const alive = await this.backend.isAlive(this.sessionId);
    const mode = !alive ? "mode-exited" : screen[0]?.startsWith("guest>") ? "mode-guest" : "mode-auth";
    const uiTree = [
      { tag: "line", role: "text", id: mode, name: mode, text: screen[0] ?? "" },
      ...screen.map((text, i) => ({
        tag: "line",
        role: "text",
        id: `line-${i}`,
        name: `line-${i}`,
        text,
      })),
    ];
    return {
      id: newId("obs"),
      runId: "run",
      environmentId: "env",
      sequence: this.seq++,
      source: "adapter-cli-pty",
      capturedAt: new Date().toISOString(),
      summary: { url: `pty://seedcli`, title: "SeedCLI", uiTree, storage: {} },
    };
  }

  async act(params: { action: Action }): Promise<ActionOutcome> {
    if (!this.sessionId) throw protocolError("VALIDATION", "environment not created");
    const action = params.action;
    const sessionId = this.sessionId;
    const base = {
      actionId: action.id,
      runId: action.runId,
      environmentId: action.environmentId,
      observedAt: new Date().toISOString(),
      stateAfter: `pty://${sessionId}`,
    };

    try {
      if (action.kind === "fault") {
        const fault = String(action.input?.fault ?? "");
        const allowed = CLI_CAPABILITIES.capabilities.faults ?? [];
        if (!allowed.includes(fault)) {
          throw protocolError("CAPABILITY_DENIED", `fault not permitted: ${fault}`);
        }
        throw new AdapterCrashError("adapter-crash: pty backend lost (injected fault)");
      }

      const wasAlive = await this.backend.isAlive(sessionId);
      if (!wasAlive) {
        return {
          ...base,
          status: "target-failure",
          error: { code: "ACTION_FAILED", message: "session not alive" },
        };
      }
      const missesBefore = await this.missesOf(sessionId);

      switch (action.kind) {
        case "fill":
          await this.backend.write(sessionId, `${String(action.input?.value ?? "")}\n`);
          break;
        case "press":
          await this.backend.write(sessionId, "\n");
          break;
        default:
          throw protocolError("VALIDATION", `unknown cli action: ${action.kind}`);
      }

      const alive = await this.backend.isAlive(sessionId);
      if (!alive) {
        const screen = await this.backend.readScreen(sessionId);
        const reason =
          screen.find((l) => l.startsWith("FATAL")) ??
          this.sessionFor(sessionId)?.exitReason ??
          "process exited";
        return {
          ...base,
          status: "target-failure",
          error: { code: "TARGET_FAILURE", message: String(reason) },
        };
      }
      const missesAfter = await this.missesOf(sessionId);
      const freshMiss = missesAfter.find((m) => !missesBefore.includes(m));
      if (freshMiss) {
        return {
          ...base,
          status: "target-failure",
          error: { code: "ACTION_FAILED", message: freshMiss },
        };
      }
      return { ...base, status: "success" };
    } catch (e) {
      if (e instanceof AdapterCrashError) throw e;
      if (e && typeof e === "object" && "code" in e) throw e;
      const message = e instanceof Error ? e.message : String(e);
      return {
        ...base,
        status: "target-failure",
        error: { code: "ACTION_FAILED", message },
      };
    }
  }

  async health(): Promise<HealthResponse> {
    return { ok: this.sessionId !== null, uptimeMs: 0, now: new Date().toISOString() };
  }

  async cancel(): Promise<void> {
    /* mock actions are instantaneous */
  }

  private async missesOf(sessionId: string): Promise<string[]> {
    const backend = this.backend as PtyBackend & {
      misses?: (id: string) => Promise<string[]>;
    };
    return backend.misses ? backend.misses(sessionId) : [];
  }

  private sessionFor(sessionId: string): { exitReason?: string } | undefined {
    const backend = this.backend as PtyBackend & {
      sessionFor?: (id: string) => { exitReason?: string } | undefined;
    };
    return backend.sessionFor?.(sessionId);
  }
}
