import type { PtyBackend, PtySession } from "./types.js";

const SCREEN_HEIGHT = 12;
const SCREEN_WIDTH = 120;
const MAX_SCROLLBACK = 1000;

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
  /** Completed output lines (scrollback). */
  lines: string[];
  /** Trailing partial line not yet terminated by a newline. */
  pending: string;
  alive: boolean;
  exitReason?: string;
}

/** Strips ANSI/VT escape sequences so the screen buffer holds plain text. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g, "");
}

/**
 * Real PTY backend over @lydell/node-pty (ConPTY on Windows). Maintains a
 * fixed-height plain-text screen buffer from VT output, matching the
 * MockPtyBackend readScreen contract. Selected via INSPECTOR_PTY=real in
 * bin.ts; MockPtyBackend remains the default.
 *
 * readScreen fidelity limitation (known, deliberate): the "screen" is the
 * tail of ANSI-stripped scrollback, NOT a terminal cell grid. Full-screen
 * TUI redraws (cursor addressing, status bars, `-- INSERT --` markers) leave
 * stale fragments in the tail, so state detection for full-screen apps is
 * unreliable. A real cell-buffer emulator is required to fix this; see
 * .inspector/rc-work/hunts/vim-pty/results.md finding #1.
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
      proc = pty.spawn(program, args, {
        name: "xterm-color",
        cols: SCREEN_WIDTH,
        rows: SCREEN_HEIGHT,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      throw new Error(`pty spawn failed for ${program}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const id = `pty-${this.seq++}`;
    const s: RealSession = { id, pty: proc, lines: [], pending: "", alive: true };
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
    const all = [...s.lines, ...(s.pending ? [s.pending] : [])];
    const tail = all.slice(-(SCREEN_HEIGHT - 1));
    const padded = [...tail];
    while (padded.length < SCREEN_HEIGHT - 1) padded.push("");
    return [...padded];
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
    const text = stripAnsi(data);
    const parts = text.split(/\r?\n/);
    s.pending += parts[0];
    for (let i = 1; i < parts.length; i++) {
      s.lines.push(s.pending);
      if (s.lines.length > MAX_SCROLLBACK) s.lines.splice(0, s.lines.length - MAX_SCROLLBACK);
      s.pending = parts[i] ?? "";
    }
  }
}
