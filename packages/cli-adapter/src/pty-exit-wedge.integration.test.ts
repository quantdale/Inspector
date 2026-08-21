import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { NodePtyBackend } from "./node-pty-backend.js";

// Regression coverage for the Windows ConPTY process-exit wedge
// (.inspector/rc-work/hunts/vim-pty/results.md finding #2): after sessions
// are killed externally, @lydell/node-pty 1.1.0 teardown leaks IPC handles /
// forks a console-list agent against a dead PID, wedging or crashing the
// HOST Node process at exit even though adapter-level close() succeeded.
const ptyAvailable = await import("@lydell/node-pty").then(
  () => true,
  () => false,
);

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const reproScript = join(repoRoot, "packages/cli-adapter/scripts/pty-exit-repro.mjs");

const echoScript = `
process.stdin.setEncoding("utf8");
process.stdin.on("data", () => {});
setInterval(() => {}, 1000);
`;

describe.skipIf(!ptyAvailable)("NodePtyBackend host-exit wedge regression", () => {
  it("survives N=5 external-kill + close cycles in-process", async () => {
    const backend = new NodePtyBackend();
    for (let i = 0; i < 5; i++) {
      const { id } = await backend.spawn(process.execPath, ["-e", echoScript]);
      expect(await backend.isAlive(id)).toBe(true);
      // Kill the shell out-of-band so the pty object still believes the
      // session is alive at close time — the exact hunt scenario.
      const s = backend["sessions"].get(id);
      const childPid = (s?.pty as unknown as { pid?: number }).pid ?? -1;
      expect(childPid).toBeGreaterThan(0);
      await killTree(childPid);
      // Let the native exit callback fire before closing.
      await new Promise((r) => setTimeout(r, 1200));
      expect(await backend.isAlive(id)).toBe(false);
      await backend.kill(id); // must NOT wedge the process at exit
    }
    // The wedge manifests when THIS worker tries to exit; vitest will hang
    // here if the fix regressed. The subprocess assertion below makes that
    // failure explicit and bounded rather than an opaque worker timeout.
  }, 60000);

  it("lets a host process that spawned/killed/closed sessions exit cleanly", async () => {
    // Run the standalone repro as a real host process: it spawns N sessions,
    // kills each child externally, closes via the backend, then exits
    // naturally under its own 15s watchdog (exit 124 = wedged).
    const tsxEsm = require.resolve("tsx/esm");
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        ["--import", pathToFileURL(tsxEsm).href, reproScript, "3", "--external"],
        { cwd: repoRoot, timeout: 45000 },
        (err) => {
          if (err && err.killed) {
            reject(new Error("host process wedged at exit after PTY teardown (watchdog killed it)"));
          } else if (err && (err as NodeJS.ErrnoException).code === String(124)) {
            reject(new Error("host process wedged at exit after PTY teardown (exit 124)"));
          } else if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
  }, 60000);
});

/** Force-kills a process tree by PID (Windows taskkill, POSIX SIGKILL). */
function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/F", "/T", "/PID", String(pid)], () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      resolve();
    }
  });
}
