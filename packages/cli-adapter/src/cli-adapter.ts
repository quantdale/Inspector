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
import {
  AdapterCrashError,
  type AdapterHandler,
  redactFreeformText,
} from "@inspector/adapter-sdk";
import { ArtifactStore } from "@inspector/artifact-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import type { PtyBackend, TerminalSnapshot } from "./types.js";

export const CLI_CAPABILITIES: CapabilityDoc = {
  protocolVersion: PROTOCOL_VERSION,
  adapter: "cli-pty",
  capabilities: {
    observe: ["uiTree"],
    act: ["fill", "press", "resize", "fault"],
    lifecycle: ["create", "reset", "close"],
    faults: ["crash"],
    coverage: [],
    // SPEC-009 W1: terminal vocabulary. Input tokens come ONLY from the
    // explorer's fixed safe pool — no free-form shell command synthesis.
    vocabulary: [
      {
        kind: "terminal-input",
        targetScheme: "pty-input",
        risk: "interact",
        autonomousEligible: true,
        description: "Submit a safe keystroke token to the terminal",
      },
      {
        kind: "press",
        targetScheme: "pty-input",
        risk: "interact",
        autonomousEligible: true,
        description: "Send a control key (e.g. Ctrl-C) to the terminal",
      },
      {
        kind: "resize",
        targetScheme: "pty-input",
        risk: "interact",
        autonomousEligible: false,
        description: "Resize the deterministic terminal viewport",
      },
    ],
  },
};

/**
 * First entry of `after` whose occurrence count exceeds its count in `before`
 * (count-based multiset diff). A pure set diff would classify a REPEATED
 * identical miss as success, which corrupts reproduction/minimization.
 */
function freshError(before: string[], after: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const e of before) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const e of after) {
    const remaining = counts.get(e) ?? 0;
    if (remaining === 0) return e;
    counts.set(e, remaining - 1);
  }
  return undefined;
}

/**
 * CLI/PTY adapter (M6 subphase 1). Terminal interaction is modeled as line
 * entries (fill = submit a command line) over an injectable PTY backend.
 */
export class CliAdapterHandler implements AdapterHandler {
  private sessionId: string | null = null;
  private readonly artifacts: ArtifactStore;
  /** Unique per-instance artifact directory (mkdtemp under the base). */
  private readonly artifactDir: string;
  private runId = "run";
  private environmentId = "env";
  private seq = 0;

  constructor(
    private readonly backend: PtyBackend,
    artifactBaseDir: string = join(tmpdir(), "inspector-cli-artifacts"),
    private readonly program: string = "seedcli",
  ) {
    mkdirSync(artifactBaseDir, { recursive: true });
    // Use the RETURNED unique directory so concurrent instances never share
    // one artifact tree.
    this.artifactDir = mkdtempSync(join(artifactBaseDir, "inst-"));
    this.artifacts = new ArtifactStore(artifactBaseDir);
    void this.artifacts;
  }

  async initialize(): Promise<CapabilityDoc> {
    return CLI_CAPABILITIES;
  }

  async lifecycle(params: { op: string; options?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    switch (params.op) {
      case "create":
      case "reset": {
        this.applyAttribution(params.options);
        if (this.sessionId) await this.backend.kill(this.sessionId).catch(() => undefined);
        const session = await this.backend.spawn(this.program);
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
    const terminal = this.backend.readTerminal
      ? await this.backend.readTerminal(this.sessionId)
      : undefined;
    const screen = terminal?.viewport ?? await this.backend.readScreen(this.sessionId);
    const alive = await this.backend.isAlive(this.sessionId);
    const mode = !alive ? "mode-exited" : screen[0]?.startsWith("guest>") ? "mode-guest" : "mode-auth";
    // Freeform screen text is redacted before it becomes model/evidence input.
    const uiTree = [
      { tag: "line", role: "text", id: mode, name: mode, text: redactFreeformText(screen[0] ?? "") },
      ...screen.map((rawText, i) => ({
        tag: "line",
        role: "text",
        id: `line-${i}`,
        name: `line-${i}`,
        text: redactFreeformText(rawText),
      })),
    ];
    const terminalEvidence = terminal ? redactTerminal(terminal) : undefined;
    return {
      id: newId("obs"),
      runId: this.runId,
      environmentId: this.environmentId,
      sequence: this.seq++,
      source: "adapter-cli-pty",
      capturedAt: new Date().toISOString(),
      summary: {
        url: `pty://seedcli`,
        title: "SeedCLI",
        uiTree,
        storage: {},
        ...(terminalEvidence ? { terminal: terminalEvidence } : {}),
      },
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

      if (action.kind === "resize") {
        const cols = Number(action.input?.cols ?? 120);
        const rows = Number(action.input?.rows ?? 24);
        if (!Number.isInteger(cols) || cols < 20 || cols > 300 || !Number.isInteger(rows) || rows < 4 || rows > 100) {
          throw protocolError("VALIDATION", "resize requires cols 20..300 and rows 4..100");
        }
        if (!this.backend.resize) throw protocolError("CAPABILITY_DENIED", "PTY backend does not support resize");
        await this.backend.resize(sessionId, cols, rows);
        return { ...base, status: "success" };
      }

      const wasAlive = await this.backend.isAlive(sessionId);
      if (!wasAlive) {
        // Classify by WHY the session died so retries stay stable: an
        // application crash remains TARGET_FAILURE instead of flip-flopping
        // to a generic "session not alive" automation failure.
        return { ...base, status: "target-failure", error: await this.deadSessionError(sessionId) };
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
        return { ...base, status: "target-failure", error: await this.deadSessionError(sessionId) };
      }
      const missesAfter = await this.missesOf(sessionId);
      // Count-based freshness: a repeated identical miss is still fresh.
      const freshMiss = freshError(missesBefore, missesAfter);
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

  /**
   * Explain a dead session for outcome classification. A FATAL screen line or
   * an application exit reason is a genuine target defect (TARGET_FAILURE);
   * normal exits ("quit") and external kills are automation failures.
   */
  private async deadSessionError(
    sessionId: string,
  ): Promise<{ code: "TARGET_FAILURE" | "ACTION_FAILED"; message: string }> {
    try {
      const screen = await this.backend.readScreen(sessionId);
      const fatal = screen.find((l) => l.startsWith("FATAL"));
      if (fatal) return { code: "TARGET_FAILURE", message: fatal };
    } catch {
      /* screen unavailable; fall through to exit reason */
    }
    const exitReason = this.sessionFor(sessionId)?.exitReason;
    if (exitReason && exitReason !== "killed" && exitReason !== "quit") {
      return { code: "TARGET_FAILURE", message: exitReason };
    }
    return { code: "ACTION_FAILED", message: "session not alive" };
  }

  /** Thread real run/environment attribution from lifecycle options. */
  private applyAttribution(options?: Record<string, unknown>): void {
    const runId = options?.runId;
    const environmentId = options?.environmentId;
    if (typeof runId === "string" && runId) this.runId = runId;
    if (typeof environmentId === "string" && environmentId) {
      this.environmentId = environmentId;
    }
  }

  private sessionFor(sessionId: string): { exitReason?: string } | undefined {
    const backend = this.backend as PtyBackend & {
      sessionFor?: (id: string) => { exitReason?: string } | undefined;
    };
    return backend.sessionFor?.(sessionId);
  }
}

function redactTerminal(snapshot: TerminalSnapshot): Record<string, unknown> {
  const viewport = snapshot.viewport.map((line) => redactFreeformText(line));
  const scrollback = snapshot.scrollback.map((line) => redactFreeformText(line));
  const cells = snapshot.cells.map((row) => row.map((cell) => redactFreeformText(cell)));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ cols: snapshot.cols, rows: snapshot.rows, cells, cursor: snapshot.cursor }))
    .digest("hex");
  return {
    cols: snapshot.cols,
    rows: snapshot.rows,
    viewport,
    cells,
    scrollback,
    cursor: snapshot.cursor,
    fingerprint,
  };
}
