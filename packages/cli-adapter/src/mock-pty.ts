import type { PtyBackend, PtySession } from "./types.js";

const SCREEN_HEIGHT = 12;

interface MockSession {
  id: string;
  lines: string[]; // scrollback of emitted output
  mode: "guest" | "auth";
  user: string;
  count: number;
  alive: boolean;
  exitReason?: string;
  misses: string[];
}

/**
 * Seeded CLI target ("seedcli"). Hidden defects mirror the other seeded
 * targets: a boundary login crash, a counter overflow at >=8 (prints NaN and
 * aborts), and an explicit boom abort.
 *
 * Commands:
 *   login <user> <pass> | count | inc | boom | help | quit
 */
export class MockPtyBackend implements PtyBackend {
  deviceCrashed = false;
  private sessions = new Map<string, MockSession>();
  private seq = 0;

  async spawn(program: string, _args: string[] = []): Promise<PtySession> {
    this.assertAlive();
    if (program !== "seedcli") throw new Error(`unknown program: ${program}`);
    const id = `pty-${this.seq++}`;
    const s: MockSession = {
      id,
      lines: ["SeedCLI 1.0", "type 'help' for commands", ""],
      mode: "guest",
      user: "",
      count: 0,
      alive: true,
      misses: [],
    };
    this.sessions.set(id, s);
    return { id };
  }

  async write(sessionId: string, data: string): Promise<void> {
    this.assertAlive();
    const s = this.sessions.get(sessionId);
    if (!s || !s.alive) {
      const m = new Error("write failed: session closed");
      (m as Error & { miss?: boolean }).miss = true;
      throw m;
    }
    for (const rawLine of data.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      this.exec(s, line);
    }
  }

  async readScreen(sessionId: string): Promise<string[]> {
    this.assertAlive();
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("no such session");
    const prompt = s.alive ? (s.mode === "auth" ? `${s.user}@seedcli>` : "guest>") : "[process exited]";
    const tail = s.lines.slice(-(SCREEN_HEIGHT - 1));
    const padded = [...tail];
    while (padded.length < SCREEN_HEIGHT - 1) padded.push("");
    return [prompt, ...padded];
  }

  async isAlive(sessionId: string): Promise<boolean> {
    return this.sessions.get(sessionId)?.alive ?? false;
  }

  async kill(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.alive = false;
      s.exitReason = "killed";
    }
  }

  /** Automation-miss markers recorded by the app (command not found etc.). */
  async misses(sessionId: string): Promise<string[]> {
    return [...(this.sessions.get(sessionId)?.misses ?? [])];
  }

  /** Diagnostic hook used by tests. */
  sessionFor(sessionId: string): MockSession | undefined {
    return this.sessions.get(sessionId);
  }

  private assertAlive(): void {
    if (this.deviceCrashed) throw new Error("pty backend lost (injected fault)");
  }

  private exec(s: MockSession, line: string): void {
    const [cmd, ...args] = line.split(/\s+/);
    switch (cmd) {
      case "help":
        s.lines.push("commands: login <user> <pass>, count, inc, boom, quit");
        return;
      case "login": {
        const user = args[0] ?? "";
        if (user.length >= 64 || user === "CRASH") {
          s.lines.push("FATAL HiddenValidationCrash");
          s.alive = false;
          s.exitReason = "HiddenValidationCrash";
          return;
        }
        if (!args[0] || !args[1]) {
          s.misses.push("login requires <user> <pass>");
          s.lines.push("usage: login <user> <pass>");
          return;
        }
        s.user = user;
        s.mode = "auth";
        s.lines.push(`welcome ${user}`);
        return;
      }
      case "count":
        if (s.mode !== "auth") {
          s.misses.push("not authenticated");
          s.lines.push("error: login first");
          return;
        }
        s.lines.push(`count=${Number.isNaN(s.count) ? "NaN" : String(s.count)}`);
        return;
      case "inc": {
        if (s.mode !== "auth") {
          s.misses.push("not authenticated");
          s.lines.push("error: login first");
          return;
        }
        s.count += 1;
        if (s.count >= 8) {
          s.count = Number.NaN;
          s.lines.push("count=NaN");
          s.lines.push("FATAL IncrementOverflowCrash");
          s.alive = false;
          s.exitReason = "IncrementOverflowCrash";
          return;
        }
        s.lines.push(`count=${s.count}`);
        return;
      }
      case "boom":
        s.lines.push("FATAL IntentionalAppCrash");
        s.alive = false;
        s.exitReason = "IntentionalAppCrash";
        return;
      case "quit":
        s.alive = false;
        s.exitReason = "quit";
        return;
      default:
        s.misses.push(`command not found: ${cmd}`);
        s.lines.push(`command not found: ${cmd}`);
        return;
    }
  }
}
