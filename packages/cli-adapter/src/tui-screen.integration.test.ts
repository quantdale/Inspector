import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NodePtyBackend } from "./node-pty-backend.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "fullscreen-tui.mjs");

async function waitFor(
  backend: NodePtyBackend,
  sessionId: string,
  predicate: (viewport: string[]) => boolean,
): Promise<string[]> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const snapshot = await backend.readTerminal(sessionId);
    if (predicate(snapshot.viewport)) return snapshot.viewport;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return (await backend.readTerminal(sessionId)).viewport;
}

describe("real PTY VT viewport proof", () => {
  it("observes cursor-addressed full-screen redraws and deterministic resize", async () => {
    const backend = new NodePtyBackend();
    const session = await backend.spawn(process.execPath, [fixture]);
    try {
      const first = await waitFor(backend, session.id, (viewport) => viewport.some((line) => line.includes("Frame 1")));
      expect(first.join("\n")).toContain("Inspector TUI fixture");
      expect(first.join("\n")).toContain("Frame 1");

      await backend.write(session.id, "n");
      const second = await waitFor(backend, session.id, (viewport) => viewport.some((line) => line.includes("Frame 2")));
      expect(second.join("\n")).toContain("Frame 2");
      expect(second.join("\n")).not.toContain("Frame 1");

      await backend.resize(session.id, 80, 10);
      const resized = await backend.readTerminal(session.id);
      expect(resized.cols).toBe(80);
      expect(resized.rows).toBe(10);
      await backend.write(session.id, "q");
    } finally {
      await backend.kill(session.id).catch(() => {});
    }
  }, 30000);
});
