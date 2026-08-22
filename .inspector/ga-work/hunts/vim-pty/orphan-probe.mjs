import { join, dirname } from "node:path";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { NodePtyBackend } from "../../../../packages/cli-adapter/src/node-pty-backend.js";
import { CliAdapterHandler } from "../../../../packages/cli-adapter/src/cli-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(dirname(here)); // ga-work/hunts/vim-pty parent — writable scratch
class B extends NodePtyBackend {
  async spawn(p) {
    return super.spawn(
      p === "vim" ? "C:/Program Files/Git/usr/bin/vim.exe" : p,
      ["-R", "-"],
    );
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = () => {
  try {
    const o = execSync(
      'tasklist /FI "IMAGENAME eq vim.exe" /FO CSV /NH',
    ).toString();
    return (o.match(/vim\.exe/g) ?? []).length;
  } catch {
    return -1;
  }
};
const backend = new B();
const handler = new CliAdapterHandler(
  backend,
  mkdtempSync(join(here, "art-")),
  "vim",
);
await handler.lifecycle({
  op: "create",
  options: { runId: "orphan-probe", environmentId: "e" },
});
await sleep(800);
console.log("during session:", count());
const t0 = Date.now();
await handler.lifecycle({ op: "close" });
console.log("close took", Date.now() - t0, "ms; immediately after:", count());
for (const ms of [500, 1000, 2000]) {
  await sleep(ms);
  console.log(`+${ms}ms:`, count());
}
