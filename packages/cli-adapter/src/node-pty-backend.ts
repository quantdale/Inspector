import type { PtyBackend, PtySession, TerminalSnapshot } from "./types.js";
import { VirtualTerminal } from "./vt-screen.js";
import { existsSync, statSync } from "node:fs";
import { delimiter, join, sep } from "node:path";

export const DEFAULT_TERMINAL_ROWS = 24;
export const DEFAULT_TERMINAL_COLS = 120;

/**
 * Resolve `program` the way a shell would before handing it to the PTY.
 *
 * Platform-semantics parity (HARDENING_4 H4-D8): Windows ConPTY fails a
 * nonexistent program SYNCHRONOUSLY at CreatePseudoConsole/CreateProcess,
 * while POSIX fork/exec only discovers ENOENT asynchronously inside the
 * child — so `spawn("nonexistent")` rejected on Windows but resolved a
 * doomed session id on Linux (surfaced by hosted run 32934944139's first
 * Linux integration execution). Pre-resolving here gives every platform the
 * same fast, typed failure without racing the child's fate.
 */
export function resolveExecutablePath(program: string): string | undefined {
  const candidates = program.includes(sep) || program.includes("/")
    ? [program]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter((dir) => dir.length > 0)
        .map((dir) => join(dir, program));
  for (const candidate of candidates) {
    try {
      // Directories on PATH must not satisfy the lookup; only real files do.
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      /* unreadable entry: keep searching */
    }
  }
  return undefined;
}

/**
 * Guarded shutdown for hosts that used the real PTY backend. Arms an
 * unref'd timer that force-exits the process with its pending exit code.
 *
 * Why: @lydell/node-pty's Windows teardown can leak IPC handles (forked
 * conpty_console_list_agent channels) that keep the event loop alive
 * forever, wedging the HOST process at exit even after every session is
 * closed and the adapter-level API behaved correctly. An unref'd timer does
 * not delay a healthy drain (the process exits naturally first) but fires —
 * and force-exits — if leaked handles keep the loop wedged. Call this once
 * the host knows it is shutting down (stdin EOF, server close), not at
 * startup.
 */
export function armPtyExitGuard(delayMs = 2000): void {
  const t = setTimeout(() => {
    process.exit(process.exitCode ?? 0);
  }, delayMs);
  // Never hold the loop open for the guard itself.
  t.unref();
}

interface RealSession {
  id: string;
  pty: import("@lydell/node-pty").IPty;
  terminal: VirtualTerminal;
  alive: boolean;
  exitReason?: string;
}

/**
 * Real PTY backend over @lydell/node-pty (ConPTY on Windows). Maintains a
 * fixed-size VT cell grid from real PTY output. The current viewport and
 * scrollback are separate so full-screen TUI redraws do not leave stale tail
 * fragments in the semantic state.
 */
export class NodePtyBackend implements PtyBackend {
  private sessions = new Map<string, RealSession>();
  private seq = 0;

  async spawn(program: string, args: string[] = []): Promise<PtySession> {
    let pty: typeof import("@lydell/node-pty");
    try {
      pty = await import("@lydell/node-pty");
    } catch (e) {
      throw new Error(
        `node-pty backend unavailable (native binding failed to load): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    let proc: import("@lydell/node-pty").IPty;
    try {
      if (resolveExecutablePath(program) === undefined) {
        throw new Error(`executable not found (PATH lookup failed)`);
      }
      proc = pty.spawn(program, args, {
        name: "xterm-color",
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      throw new Error(`pty spawn failed for ${program}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const id = `pty-${this.seq++}`;
    const s: RealSession = {
      id,
      pty: proc,
      terminal: new VirtualTerminal(DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS),
      alive: true,
    };
    proc.onData((data) => this.onOutput(s, data));
    proc.onExit(({ exitCode }) => {
      s.alive = false;
      s.exitReason = `exit code ${exitCode}`;
    });
    this.sessions.set(id, s);
    return { id };
  }

  async write(sessionId: string, data: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || !s.alive) {
      const m = new Error("write failed: session closed");
      (m as Error & { miss?: boolean }).miss = true;
      throw m;
    }
    // ConPTY line discipline treats \r as Enter; adapt the adapter's
    // "\n terminates a line" convention.
    s.pty.write(data.replace(/\n/g, "\r"));
  }

  async readScreen(sessionId: string): Promise<string[]> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("no such session");
    return s.terminal.snapshot().viewport;
  }

  async readTerminal(sessionId: string): Promise<TerminalSnapshot> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("no such session");
    return s.terminal.snapshot();
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || !s.alive) throw new Error("resize failed: session closed");
    s.pty.resize(cols, rows);
    s.terminal.resize(cols, rows);
  }

  async isAlive(sessionId: string): Promise<boolean> {
    return this.sessions.get(sessionId)?.alive ?? false;
  }

  async kill(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.alive) {
      s.alive = false;
      s.exitReason = "killed";
      try {
        s.pty.kill();
      } catch {
        /* already gone */
      }
    }
    // If the session is already dead (e.g. killed externally via taskkill),
    // do NOT call pty.kill(): upstream WindowsPtyAgent.kill() unconditionally
    // forks conpty_console_list_agent against the dead shell PID. That
    // agent's native AttachConsole/getConsoleProcessList fails or wedges, its
    // IPC channel Socket leaks into OUR process, and the host Node process
    // hangs at exit ("AttachConsole failed", watchdog kill).
    //
    // The session's conout worker thread and out socket still need explicit
    // teardown though (upstream disposes them only inside kill()), otherwise
    // their handles keep the host event loop alive forever. Dispose them
    // directly — same work as upstream _cleanUpProcess + ConoutConnection
    // dispose, minus the console-list fork. Access to the private _agent is
    // a deliberate, contained workaround for the shipped @lydell/node-pty
    // 1.1.0 teardown defect; re-check on dependency upgrades.
    if (!s.alive) {
      const agent = (s.pty as unknown as { _agent?: { _conoutSocketWorker?: { dispose(): void }; _outSocket?: { destroy(): void } } })._agent;
      try {
        agent?._conoutSocketWorker?.dispose();
      } catch {
        /* best effort */
      }
      try {
        agent?._outSocket?.destroy();
      } catch {
        /* best effort */
      }
    }
  }

  private onOutput(s: RealSession, data: string): void {
    s.terminal.feed(data);
  }
}
