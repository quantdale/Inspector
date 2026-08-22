/**
 * Focused diagnostic: why does calc go candidate-blind after ~1 interaction
 * in ga-uia-soak? Attach, enumerate, interact once, re-enumerate verbosely.
 */
import { spawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RealUiaBackend } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(
  fn: () => Promise<boolean>,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch {
      /* keep polling */
    }
    await sleep(400);
  }
  return false;
}

spawn("cmd", ["/c", "start", "", "calc.exe"], {
  detached: true,
  stdio: "ignore",
}).unref();
await sleep(2500);

const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
const backend = new RealUiaBackend(bridge);
let pid = 0;
try {
  const out = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Process CalculatorApp | Select-Object -First 1).Id",
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  pid = Number.parseInt((out.stdout ?? "").trim(), 10);
} catch {
  /* title fallback */
}

const appeared = await waitUntil(async () => {
  const wins = await backend.listWindows();
  const hit = wins.find(
    (w) => (pid && w.pid === pid) || /calcul/i.test(w.title),
  );
  if (hit) {
    pid = hit.pid;
    await backend.attach({ pid: hit.pid });
    return true;
  }
  return false;
}, 45000);
if (!appeared) throw new Error("calc never appeared");
console.log("attached pid", pid);

function dump(
  tag: string,
  nodes: {
    id: string;
    type: string;
    name: string | null;
    enabled: boolean;
    offscreen: boolean;
    patterns: string[];
  }[],
) {
  console.log(`--- ${tag}: ${nodes.length} nodes`);
  const interactive = nodes.filter(
    (n) =>
      n.enabled &&
      !n.offscreen &&
      (n.patterns.some((p) => p.includes("Invoke")) ||
        n.patterns.some((p) => p.includes("Toggle")) ||
        (n.type === "Edit" && n.patterns.some((p) => p.includes("Value")))),
  );
  console.log(`interactive+enabled+onscreen: ${interactive.length}`);
  for (const n of interactive.slice(0, 12)) {
    console.log(
      `   ${n.type} "${(n.name ?? "").slice(0, 40)}" [${n.patterns.join(",")}]`,
    );
  }
}

const t1 = await backend.richTree();
console.log("tree1 nodes:", t1.nodes.length, "reattached:", !!t1.reattached);
dump("tree1", t1.nodes);

// Replicate the soak's modal-safe filter and novelty pick.
const safe = /^(?!.*(file|open|save|print|exit|about|settings|feedback)).*$/i;
const pool = t1.nodes.filter(
  (n) =>
    n.enabled &&
    !n.offscreen &&
    safe.test(n.name ?? "") &&
    (n.patterns.some((p) => p.includes("InvokePattern")) ||
      n.patterns.some((p) => p.includes("TogglePattern")) ||
      (n.type === "Edit" &&
        n.patterns.some((p) => p.includes("ValuePattern")))),
);
if (pool.length === 0) throw new Error("no candidates even on tree1");
const pick = pool[0]!;
console.log(`PICK: ${pick.type} "${pick.name}" [${pick.patterns.join(",")}]`);

try {
  if (pick.patterns.some((p) => p.includes("InvokePattern")))
    await backend.invoke(pick.id);
  else if (pick.patterns.some((p) => p.includes("TogglePattern")))
    await backend.toggle(pick.id);
  else {
    const b = await backend.readValue(pick.id);
    await backend.setValue(pick.id, `${b}x`.slice(0, 30));
  }
  console.log("action ok");
} catch (e) {
  console.log("action failed:", String(e).slice(0, 140));
}
await sleep(1200);

const t2raw = await bridge
  .request<{ nodes: unknown[] }>("tree")
  .catch((e) => ({ err: String(e), nodes: [] }));
console.log(
  "RAW tree2 node count (bypassing richTree):",
  Array.isArray(t2raw.nodes) ? t2raw.nodes.length : t2raw,
);
if (Array.isArray(t2raw.nodes)) {
  for (const n of t2raw.nodes.slice(0, 6))
    console.log("   raw:", JSON.stringify(n).slice(0, 160));
}

const t2 = await backend.richTree().catch((e) => ({ err: String(e) }));
console.log(
  "richTree2:",
  "err" in t2
    ? t2.err
    : `nodes=${t2.nodes.length} reattached=${!!(t2 as { reattached?: boolean }).reattached}`,
);
if (!("err" in t2)) dump("tree2", t2.nodes);

// cleanup
try {
  await backend.closeWindow();
} catch {
  /* gone */
}
await waitUntil(async () => {
  const wins = await backend.listWindows();
  return !wins.some((w) => w.pid === pid);
}, 20000).catch(() => false);
if (
  spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  }).stdout.includes(String(pid))
) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15000 });
}
bridge.dispose();
