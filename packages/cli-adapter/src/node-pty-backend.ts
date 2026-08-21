import type { PtyBackend, PtySession } from "./types.js";

const SCREEN_HEIGHT = 12;
const SCREEN_WIDTH = 120;
const MAX_SCROLLBACK = 1000;

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
