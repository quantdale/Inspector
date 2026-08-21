// Minimal reproduction of the node-pty process-exit wedge on Windows ConPTY.
// Spawns N sessions via NodePtyBackend, kills each child, then lets the host
// process exit naturally. A watchdog reports whether exit completes.
//
// Usage: node scripts/pty-exit-repro.mjs [N] [--external]
//   --external  kill each child out-of-band via taskkill before close()
//               (the hunt scenario that wedges the host at exit)
import { setTimeout as sleep } from "node:timers/promises";
import { setTimeout } from "node:timers";
import { NodePtyBackend } from "../src/node-pty-backend.js";

const n = Number(process.argv[2] ?? 5);
// --external: kill each child out-of-band via taskkill (as a hunt watchdog
// would), then still run backend.kill() on the dead session like close() does.
const externalKill = process.argv.includes("--external");

const WATCHDOG_MS = 15000;
const watchdog = setTimeout(() => {
  console.error(`WATCHDOG: host process failed to exit within ${WATCHDOG_MS}ms after all sessions closed`);
  console.error("WATCHDOG: active handles:", (process._getActiveHandles?.() ?? []).map((h) => h?.constructor?.name));
  process.exit(124);
}, WATCHDOG_MS);
watchdog.unref();

const backend = new NodePtyBackend();

/** IPty.pid is the inner shell PID on Windows (ConPTY). */
function childPidOf(backend, id) {
  // `sessions` is TS-private; compile-time only, safe to reach from the script.
  return backend.sessions.get(id)?.pty?.pid ?? 0;
}

const echoScript = `
process.stdin.setEncoding("utf8");
process.stdin.on("data", () => {});
setInterval(() => {}, 1000);
`;

for (let i = 0; i < n; i++) {
  const { id } = await backend.spawn(process.execPath, ["-e", echoScript]);
  await sleep(200);
  const alive = await backend.isAlive(id);
  if (externalKill) {
    // Kill the shell out-of-band; the pty object does not know yet.
    const { execSync } = await import("node:child_process");
    try {
      execSync(`taskkill /F /T /PID ${childPidOf(backend, id)}`, { stdio: "ignore" });
    } catch {
      /* already gone */
    }
    await sleep(1200); // let onExit fire (~300ms poll)
  }
  await backend.kill(id);
  console.log(`session ${id}: aliveAtKill=${alive}`);
}
console.log(`all ${n} sessions killed; letting host process exit naturally...`);
