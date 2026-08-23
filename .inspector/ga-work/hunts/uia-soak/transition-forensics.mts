/**
 * Forensic: drive Calculator to the rehost transition, then immediately
 * snapshot listWindows + desktop children to see what the post-transition
 * world looks like while attemptReattach would be polling.
 */
import { spawn, spawnSync } from "node:child_process";
import { RealUiaBackend, type UiaRichNode } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bridge = new PowerShellUiaBridge({ timeoutMs: 20000 });
const backend = new RealUiaBackend(bridge);

function calcPids(): number[] {
  const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq CalculatorApp.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15000 });
  const pids: number[] = [];
  for (const line of (out.stdout ?? "").split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m && /calculator/i.test(m[1]!)) pids.push(Number(m[2]));
  }
  return pids;
}

// clean launch
spawnSync("taskkill", ["/F", "/IM", "CalculatorApp.exe"], { timeout: 15000 });
await sleep(2000);
spawn("cmd", ["/c", "start", "", "calc.exe"], { detached: true, stdio: "ignore" }).unref();
let attachedPid = 0;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  const wins = await backend.listWindows();
  const hit = wins.find((w) => /calcul/i.test(w.title));
  if (hit) { attachedPid = hit.pid; await backend.attach({ pid: hit.pid }); break; }
}
console.log("attached", attachedPid);
const base = await backend.richTree();
console.log("baseline nodes:", base.nodes.length);

const invoked = new Set<string>();
let transitionAt = -1;
for (let i = 0; i < 60 && transitionAt < 0; i++) {
  const t = await backend.richTree();
  const btns = t.nodes.filter(
    (n) => n.enabled && !n.offscreen &&
      n.patterns.some((p) => p.includes("InvokePattern")) &&
      !/^(minimize|maximize|close)\b/i.test(n.name.trim()),
  );
  const freshOnes = btns.filter((b) => !invoked.has(b.id));
  const pick = freshOnes[0] ?? btns[i % Math.max(btns.length, 1)];
  if (!pick) { console.log(i, "no buttons"); break; }
  invoked.add(pick.id);
  try {
    await backend.invoke(pick.id);
    console.log(`act ${i}: invoked "${pick.name}"`);
  } catch (e) {
    console.log(`act ${i}: invoke failed "${pick.name}": ${String(e).slice(0, 90)}`);
  }
  await sleep(600);
  try {
    const probe = await backend.richTree();
    if (probe.nodes.length <= 1) {
      transitionAt = i;
      console.log(`TRANSITION after act ${i} ("${pick.name}") -> root-only`);
      break;
    }
  } catch (e) {
    transitionAt = i;
    console.log(`TRANSITION after act ${i}: richTree threw: ${String(e).slice(0, 120)}`);
    break;
  }
}

if (transitionAt >= 0) {
  for (let s = 1; s <= 12; s++) {
    await sleep(1000);
    const wins = await backend.listWindows().catch(() => []);
    const allPids = calcPids();
    console.log(`+${s}s windows=`, JSON.stringify(wins), "calcProcs=", JSON.stringify(allPids));
  }
}
bridge.dispose();
