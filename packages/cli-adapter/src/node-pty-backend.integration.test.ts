import { describe, it, expect } from "vitest";
import { DEFAULT_TERMINAL_ROWS, NodePtyBackend } from "./node-pty-backend.js";

// Probe the native binding without failing on machines where @lydell/node-pty
// cannot load; those machines skip gracefully and stay green.
const ptyAvailable = await import("@lydell/node-pty").then(
  () => true,
  () => false,
);

/** Polls until `pred` holds for the screen or the deadline expires. */
async function waitForScreen(
  backend: NodePtyBackend,
  sessionId: string,
  pred: (lines: string[]) => boolean,
  timeoutMs = 10000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let screen = await backend.readScreen(sessionId);
  while (!pred(screen) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    screen = await backend.readScreen(sessionId);
  }
  return screen;
}

const echoScript = `
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line === "quit") process.exit(0);
    console.log("echo:" + line);
  }
});
`;

describe.skipIf(!ptyAvailable)("NodePtyBackend (real PTY)", () => {
  it("spawns a real process and round-trips write/readScreen/isAlive/kill", async () => {
    const backend = new NodePtyBackend();

    // Spawn: node -e <echoScript> under ConPTY.
    const { id } = await backend.spawn(process.execPath, ["-e", echoScript]);
    expect(await backend.isAlive(id)).toBe(true);

    // Write -> readScreen sees the echoed line.
    await backend.write(id, "hello-pty\n");
    const screen = await waitForScreen(backend, id, (lines) =>
      lines.some((l) => l.includes("echo:hello-pty")),
    );
    expect(screen.some((l) => l.includes("echo:hello-pty"))).toBe(true);

    // The semantic screen is a fixed-height VT viewport. Raw scrollback is
    // exposed separately through readTerminal and is not the state model.
    expect(screen).toHaveLength(DEFAULT_TERMINAL_ROWS);
    const terminal = await backend.readTerminal(id);
    expect(terminal.viewport).toEqual(screen);
    expect(terminal.rows).toBe(DEFAULT_TERMINAL_ROWS);
    expect(terminal.cols).toBeGreaterThan(0);

    // Graceful exit via input is observed by isAlive.
    await backend.write(id, "quit\n");
    expect(await pollUntil(() => backend.isAlive(id), false, 5000)).toBe(false);

    // kill terminates a fresh session.
    const k = await backend.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    expect(await backend.isAlive(k.id)).toBe(true);
    await backend.kill(k.id);
    expect(await pollUntil(() => backend.isAlive(k.id), false, 5000)).toBe(false);
  });

  it("rejects spawn of a nonexistent program with a clear error", async () => {
    const backend = new NodePtyBackend();
    await expect(backend.spawn("definitely-not-a-real-program-xyz")).rejects.toThrow(/pty spawn failed/i);
  });
});

async function pollUntil<T>(fn: () => Promise<T>, want: T, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = await fn();
  while (!(v === want) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}
