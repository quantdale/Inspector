import { join, dirname } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodePtyBackend } from "../../../../packages/cli-adapter/src/node-pty-backend.js";
import { CliAdapterHandler } from "../../../../packages/cli-adapter/src/cli-adapter.js";
import { resolveVimExe, imagePids, pidAlive } from "../../tools/discovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const VIM = resolveVimExe();
// Long-path scratch ONLY: os.tmpdir() short form (MICHAE~1) hard-crashes
// ConPTY spawns (see ga-soak.mjs note).
const REPO_TMP = mkdirSync(join(here, "..", "..", "..", "..", ".inspector", "tmp"), { recursive: true });
process.chdir(mkdtempSync(join(REPO_TMP, "ga-vim-probe-"))); // writable scratch outside source control
class B extends NodePtyBackend {
  async spawn(p) {
    return super.spawn(p === "vim" ? VIM : p, ["-R", "-"]);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = () => imagePids("vim.exe").length;

let before = imagePids("vim.exe");
const backend = new B();
const handler = new CliAdapterHandler(
  backend,
  mkdtempSync(join(here, "art-")),
  "vim",
);
await handler.lifecycle({
  op: "create",
  options: { runId: "orphan_probe", environmentId: "e" },
});
await sleep(800);
const afterSpawn = imagePids("vim.exe");
const sessionPids = afterSpawn.filter((p) => !before.includes(p));
console.log("during session:", count(), "session-attributable pids:", sessionPids);
const t0 = Date.now();
await handler.lifecycle({ op: "close" });
console.log("close took", Date.now() - t0, "ms; immediately after:", count());
for (const ms of [500, 1000, 2000]) {
  await sleep(ms);
  console.log(`+${ms}ms: global=${count()} sessionPidsAlive=`, sessionPids.filter(pidAlive));
}
