/**
 * Verbose diagnostic: calc REATTACH_FAILED (57 -> 0 nodes) and notepad
 * process death after 1 interaction. Logs every pick + tree evolution.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RealUiaBackend } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";

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

interface Spec {
  proc: string;
  startArgs: string[];
  titleRe: RegExp;
  safe: RegExp;
}

const SPECS: Record<string, Spec> = {
  calc: {
    proc: "CalculatorApp",
    startArgs: ["/c", "start", "", "calc.exe"],
    titleRe: /calcul/i,
    safe: /^(?!.*(file|open|save|print|exit|about|settings|feedback|minimize|maximize|\bclose\b|navigation)).*$/i,
  },
  notepad: {
    proc: "Notepad",
    startArgs: ["/c", "start", "notepad"],
    titleRe: /notepad/i,
    safe: /^(?!.*(file|open|save|print|exit|about|replace|goto|find|minimize|maximize|\bclose\b)).*$/i,
  },
};

async function probe(
  name: string,
  spec: Spec,
  interactions: number,
): Promise<void> {
  console.log(`\n===== ${name} =====`);
  spawn("cmd", spec.startArgs, { detached: true, stdio: "ignore" }).unref();
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
        `(Get-Process ${spec.proc} | Select-Object -First 1).Id`,
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
      (w) => (pid && w.pid === pid) || spec.titleRe.test(w.title),
    );
    if (hit) {
      pid = hit.pid;
      await backend.attach({ pid: hit.pid });
      return true;
    }
    return false;
  }, 45000);
  if (!appeared) {
    console.log(`${name}: never appeared`);
    bridge.dispose();
    return;
  }
  console.log("attached pid", pid);

  const invoked = new Map<string, number>();
  for (let i = 0; i < interactions; i++) {
    let tree;
    try {
      tree = await backend.richTree();
    } catch (e) {
      console.log(`step ${i}: richTree FAILED: ${String(e).slice(0, 130)}`);
      break;
    }
    const pool = tree.nodes.filter(
      (n) =>
        n.enabled &&
        !n.offscreen &&
        spec.safe.test(n.name ?? "") &&
        (n.patterns.some((p) => p.includes("InvokePattern")) ||
          n.patterns.some((p) => p.includes("TogglePattern")) ||
          (n.type === "Edit" &&
            n.patterns.some((p) => p.includes("ValuePattern")))),
    );
    console.log(
      `step ${i}: tree=${tree.nodes.length} nodes, candidates=${pool.length}, reattached=${!!(tree as { reattached?: boolean }).reattached}`,
    );
    if (pool.length === 0) {
      // dump what IS there
      for (const n of tree.nodes.slice(0, 5)) {
        console.log(
          `   remaining: ${n.type} "${(n.name ?? "").slice(0, 30)}" offscreen=${n.offscreen} enabled=${n.enabled} [${n.patterns.join(",").slice(0, 60)}]`,
        );
      }
      break;
    }
    pool.sort((a, b) => (invoked.get(a.id) ?? 0) - (invoked.get(b.id) ?? 0));
    const pick = pool[0]!;
    invoked.set(pick.id, (invoked.get(pick.id) ?? 0) + 1);
    try {
      if (pick.patterns.some((p) => p.includes("InvokePattern")))
        await backend.invoke(pick.id);
      else if (pick.patterns.some((p) => p.includes("TogglePattern")))
        await backend.toggle(pick.id);
      else {
        const b = await backend.readValue(pick.id);
        await backend.setValue(pick.id, `${b}x`.slice(0, 30));
      }
      console.log(`   acted: ${pick.type} "${pick.name}" ok`);
    } catch (e) {
      console.log(
        `   acted: ${pick.type} "${pick.name}" FAILED: ${String(e).slice(0, 110)}`,
      );
    }
    await sleep(900);
  }

  try {
    await backend.closeWindow();
  } catch {
    /* gone */
  }
  await waitUntil(async () => {
    const wins = await backend.listWindows();
    return !wins.some((w) => w.pid === pid);
  }, 15000).catch(() => false);
  if (
    spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
    }).stdout.includes(String(pid))
  ) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      timeout: 15000,
    });
  }
  bridge.dispose();
}

await probe("calc", SPECS.calc!, 8);
await probe("notepad", SPECS.notepad!, 8);
