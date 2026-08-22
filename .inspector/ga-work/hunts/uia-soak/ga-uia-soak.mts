/**
 * GA field soak: real UIA backend (PowerShell bridge) across Calculator,
 * Paint, and Notepad. Multi-cycle launch/attach/interact/close with:
 *  - rehost instrumentation (`richTree().reattached` events, bounded by design)
 *  - kill probes (dead target must report alive:false and fail honestly)
 *  - modal/chrome-safe candidate filter (no File/Open/Save dialogs, no
 *    Minimize/Maximize/Close window buttons that destroy or hide the target)
 *  - one shared bridge per run to exercise PowerShell bridge longevity
 *  - resource snapshots per cycle
 *
 * Env:  GA_UIA_TARGETS=mspaint,calc,notepad   target order override
 *       GA_UIA_SETTLE=350                     post-action settle ms
 *       GA_UIA_VERBOSE=1                      per-step logging + failure autopsy
 *
 * Run from repo root:
 *   node --import tsx .inspector/ga-work/hunts/uia-soak/ga-uia-soak.mts [cyclesPerTarget]
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RealUiaBackend } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";
import type { UiaRichNode } from "../../../../packages/windows-adapter/src/real-uia.js";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CYCLES_PER_TARGET = Number(process.argv[2] ?? 2);
const MAX_INTERACTIONS = 25;
const SETTLE = Number(process.env.GA_UIA_SETTLE ?? 350);
const VERBOSE = !!process.env.GA_UIA_VERBOSE;

type TargetId = "calc" | "mspaint" | "notepad";

interface TargetSpec {
  proc: string;
  startArgs: string[];
  titleRe: RegExp;
  modalSafe: RegExp;
}

const TARGETS: Record<TargetId, TargetSpec> = {
  calc: {
    proc: "CalculatorApp",
    startArgs: ["/c", "start", "", "calc.exe"],
    titleRe: /calcul/i,
    modalSafe:
      /^(?!.*(file|open|save|print|exit|about|settings|feedback|navigation)).*$/i,
  },
  mspaint: {
    proc: "mspaint",
    startArgs: ["/c", "start", "mspaint"],
    titleRe: /paint/i,
    modalSafe: /^(?!.*(file|open|save|print|exit|about|feedback)).*$/i,
  },
  notepad: {
    proc: "Notepad",
    startArgs: ["/c", "start", "notepad"],
    titleRe: /notepad/i,
    modalSafe: /^(?!.*(file|open|save|print|exit|about|replace|goto|find)).*$/i,
  },
};

function pidAlive(pid: number): boolean {
  try {
    const out = spawnSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", timeout: 15000 },
    );
    return out.stdout.includes(String(pid));
  } catch {
    return false;
  }
}

function rssMB(): number {
  return Number((process.memoryUsage().rss / 1048576).toFixed(1));
}

function powershellBridgeCount(): number {
  try {
    const out = execSync(
      'tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV /NH',
      {
        encoding: "utf8",
        timeout: 15000,
      },
    );
    return (out.match(/powershell\.exe/g) ?? []).length;
  } catch {
    return -1;
  }
}

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

/** Chrome-prefix guard: invoking these destroys or hides the target. */
function isWindowChrome(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n.startsWith("minimize") ||
    n.startsWith("maximize") ||
    n.startsWith("close")
  );
}

interface Candidate {
  node: UiaRichNode;
  kind: "invoke" | "toggle" | "fill";
}

function candidates(nodes: UiaRichNode[], safe: RegExp): Candidate[] {
  const out: Candidate[] = [];
  for (const n of nodes) {
    if (!n.enabled || n.offscreen) continue;
    const name = n.name ?? "";
    if (!safe.test(name)) continue;
    if (isWindowChrome(name)) continue;
    if (n.type === "Edit" && n.patterns.some((p) => p.includes("ValuePattern")))
      out.push({ node: n, kind: "fill" });
    else if (n.patterns.some((p) => p.includes("InvokePattern")))
      out.push({ node: n, kind: "invoke" });
    else if (n.patterns.some((p) => p.includes("TogglePattern")))
      out.push({ node: n, kind: "toggle" });
  }
  return out;
}

interface CycleRecord {
  target: TargetId;
  cycle: number;
  pid: number;
  attachedVia: string;
  treeNodesFirst: number;
  interactions: number;
  successes: number;
  failures: { rid: string; error: string }[];
  reattachEvents: number;
  closeOk: boolean;
  killProbe?: {
    killed: boolean;
    statusAfterKill: unknown;
    opAfterKillError: string;
  };
  residualProcessKilled: boolean;
}

async function runCycle(
  backend: RealUiaBackend,
  target: TargetId,
  cycle: number,
  doKillProbe: boolean,
): Promise<CycleRecord> {
  const t = TARGETS[target];
  const rec: CycleRecord = {
    target,
    cycle,
    pid: 0,
    attachedVia: "",
    treeNodesFirst: 0,
    interactions: 0,
    successes: 0,
    failures: [],
    reattachEvents: 0,
    closeOk: false,
    residualProcessKilled: false,
  };

  spawn("cmd", t.startArgs, { detached: true, stdio: "ignore" }).unref();
  await sleep(2500);

  // Resolve pid: named process first; fall back to window-title discovery.
  let pid = 0;
  try {
    const out = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process ${t.proc} | Select-Object -First 1).Id`,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    pid = Number.parseInt((out.stdout ?? "").trim(), 10);
  } catch {
    /* fall through to title discovery */
  }

  const appeared = await waitUntil(async () => {
    const wins = await backend.listWindows();
    const hit =
      wins.find((w) => (pid && w.pid === pid) || t.titleRe.test(w.title)) ??
      null;
    if (hit) {
      rec.pid = hit.pid;
      rec.attachedVia =
        pid && hit.pid === pid ? "named-pid" : "title-discovery";
      await backend.attach({ pid: hit.pid });
      return true;
    }
    return false;
  }, 45000);
  if (!appeared) throw new Error(`${target} window never appeared`);

  const firstTree = await backend.richTree();
  rec.treeNodesFirst = firstTree.nodes.length;
  rec.reattachEvents += firstTree.reattached ? 1 : 0;

  const invoked = new Map<string, number>();
  for (let i = 0; i < MAX_INTERACTIONS; i++) {
    let tree;
    try {
      tree = await backend.richTree();
    } catch (e) {
      if (VERBOSE) {
        try {
          const psOut = spawnSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$p = Get-Process -Id ${rec.pid} -ErrorAction SilentlyContinue; if ($p) { "alive=" + (-not $p.HasExited) + " responding=" + $p.Responding } else { "GONE" }`,
            ],
            { encoding: "utf8", timeout: 20000 },
          );
          console.log(
            `verbose: process check => ${(psOut.stdout ?? "").trim()}`,
          );
        } catch {
          /* ignore */
        }
      }
      rec.failures.push({ rid: "(tree)", error: String(e).slice(0, 160) });
      break;
    }
    rec.reattachEvents += tree.reattached ? 1 : 0;
    const pool = candidates(tree.nodes, t.modalSafe).filter(
      (c) => c.kind !== "fill" || !/search|address/i.test(c.node.name ?? ""),
    );
    if (pool.length === 0) break;
    pool.sort(
      (a, b) => (invoked.get(a.node.id) ?? 0) - (invoked.get(b.node.id) ?? 0),
    );
    const pick = pool[0]!;
    invoked.set(pick.node.id, (invoked.get(pick.node.id) ?? 0) + 1);
    rec.interactions += 1;
    if (VERBOSE) {
      console.log(
        `step ${i}: tree=${tree.nodes.length} pool=${pool.length} pick=${pick.node.type} "${pick.node.name}" kind=${pick.kind}`,
      );
    }
    try {
      if (pick.kind === "invoke") await backend.invoke(pick.node.id);
      else if (pick.kind === "toggle") await backend.toggle(pick.node.id);
      else {
        const before = await backend.readValue(pick.node.id);
        await backend.setValue(pick.node.id, `${before}ga`.slice(0, 40));
        await backend.setValue(pick.node.id, before);
      }
      rec.successes += 1;
    } catch (e) {
      rec.failures.push({ rid: pick.node.id, error: String(e).slice(0, 160) });
    }
    await sleep(SETTLE);

    if (doKillProbe && i === Math.floor(MAX_INTERACTIONS / 2)) {
      const kill = spawnSync(
        "taskkill",
        ["/PID", String(rec.pid), "/T", "/F"],
        {
          encoding: "utf8",
          timeout: 15000,
        },
      );
      await sleep(1200);
      const status = await backend
        .windowStatus()
        .catch((e) => ({ err: String(e) }));
      let opErr = "";
      try {
        await backend.richTree();
        opErr = "(tree unexpectedly succeeded)";
      } catch (e) {
        opErr = String(e).slice(0, 160);
      }
      rec.killProbe = {
        killed: kill.status === 0 || kill.status === 128,
        statusAfterKill: status,
        opAfterKillError: opErr,
      };
      break;
    }
  }

  // Graceful close through the Window pattern; verify window disappearance.
  try {
    await backend.closeWindow();
  } catch {
    /* packaged apps may already be gone */
  }
  rec.closeOk = await waitUntil(async () => {
    const wins = await backend.listWindows();
    return !wins.some((w) => w.pid === rec.pid);
  }, 20000);

  if (pidAlive(rec.pid)) {
    spawnSync("taskkill", ["/PID", String(rec.pid), "/T", "/F"], {
      timeout: 15000,
    });
    rec.residualProcessKilled = !(await waitUntil(
      async () => !pidAlive(rec.pid),
      10000,
    ));
  }
  await sleep(800); // let the shell settle between cycles
  return rec;
}

// ---- main ---------------------------------------------------------------
const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
const backend = new RealUiaBackend(bridge);
const cycles: CycleRecord[] = [];
const resources: Record<string, unknown>[] = [];
const order: TargetId[] = (process.env.GA_UIA_TARGETS ?? "mspaint,calc,notepad")
  .split(",")
  .map((s) => s.trim()) as TargetId[];

try {
  for (let c = 0; c < CYCLES_PER_TARGET; c++) {
    for (const target of order) {
      const doKillProbe = c === CYCLES_PER_TARGET - 1;
      try {
        const rec = await runCycle(backend, target, c, doKillProbe);
        cycles.push(rec);
      } catch (e) {
        cycles.push({
          target,
          cycle: c,
          pid: 0,
          attachedVia: "FATAL: " + String(e).slice(0, 140),
          treeNodesFirst: 0,
          interactions: 0,
          successes: 0,
          failures: [],
          reattachEvents: 0,
          closeOk: false,
          residualProcessKilled: false,
        });
      }
      resources.push({
        afterCycle: `${target}#${c}`,
        rssMB: rssMB(),
        powershellProcesses: powershellBridgeCount(),
      });
    }
  }
} finally {
  bridge.dispose();
}
await sleep(1500);

const summary = {
  cyclesTotal: cycles.length,
  cyclesFatal: cycles.filter((c) => c.attachedVia.startsWith("FATAL")).length,
  interactionsTotal: cycles.reduce((s, c) => s + c.interactions, 0),
  successTotal: cycles.reduce((s, c) => s + c.successes, 0),
  failureTotal: cycles.reduce((s, c) => s + c.failures.length, 0),
  reattachEventsTotal: cycles.reduce((s, c) => s + c.reattachEvents, 0),
  killProbes: cycles
    .filter((c) => c.killProbe)
    .map((c) => ({ target: c.target, cycle: c.cycle, ...c.killProbe })),
  resources,
  cycles,
};
writeFileSync(
  join(here, "ga-uia-summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 1));
