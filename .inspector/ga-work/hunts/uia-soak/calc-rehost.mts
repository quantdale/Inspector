/**
 * GA P6: reproduce Calculator's rehost/subtree-collapse behavior (C-F2) and
 * validate the RC1 root-reattach fix covers it.
 *
 * Sequence: launch -> attach -> baseline richTree -> invoke navigation-style
 * triggers by NAME -> repeated richTree probes logging node counts,
 * `reattached` recovery events, and error classes. Verdict:
 *   - tree stays full or recovers with reattached:true  => fix covers C-F2
 *   - silent root-only stub returned                    => REGRESSION (blind)
 *   - REATTACH_FAILED with truthful reason              => honest, bounded
 *
 * Run from repo root:  node --import tsx .inspector/ga-work/hunts/uia-soak/calc-rehost.mts
 */
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RealUiaBackend } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function calcPids(): number[] {
  const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq CalculatorApp.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15000 });
  const pids: number[] = [];
  for (const line of (out.stdout ?? "").split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m && /calculator/i.test(m[1]!)) pids.push(Number(m[2]));
  }
  return pids;
}

/** Pre-launch sweep: UWP single-instance activation makes `start calc.exe` a
 * no-op when a host lingers, so clear stale hosts first and record them. */
async function sweepCalc(): Promise<number[]> {
  const victims = calcPids();
  for (const pid of victims) {
    try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15000 }); } catch {}
  }
  if (victims.length > 0) await sleep(1000);
  return victims;
}

async function killPid(pid: number) {
  try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15000 }); } catch {}
}

async function waitUntil(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch {}
    await sleep(400);
  }
  return false;
}

const bridge = new PowerShellUiaBridge({ timeoutMs: 15000 });
const backend = new RealUiaBackend(bridge);
const timeline: Record<string, unknown>[] = [];

try {
  // Fresh Calculator instance
  const swept = await sweepCalc();
  timeline.push({ event: "swept-stale-hosts", pids: swept });
  const before = new Set(calcPids());
  spawn("cmd", ["/c", "start", "", "calc.exe"], { detached: true, stdio: "ignore" }).unref();
  let pid = 0;
  const appeared = await waitUntil(async () => {
    const fresh = calcPids().filter((p) => !before.has(p));
    const wins = await backend.listWindows();
    // The visible window may be owned by a different pid than the
    // CalculatorApp host processes (observed on Win11), so fall back to the
    // title match exactly like the portfolio soak.
    const hit = wins.find((w) => (fresh.length > 0 && fresh.includes(w.pid)) || /calcul/i.test(w.title));
    if (!hit) return false;
    pid = hit.pid;
    await backend.attach({ pid: hit.pid });
    return true;
  }, 45000);
  if (!appeared) throw new Error("calculator window never appeared");
  timeline.push({ event: "attached", pid });

  const base = await backend.richTree();
  timeline.push({ event: "baseline", nodes: base.nodes.length, reattached: !!base.reattached });
  const buttons = base.nodes.filter((n) => n.type === "Button" && n.enabled);
  timeline.push({
    event: "candidates",
    names: buttons.map((b) => b.name).slice(0, 40),
  });

  // Invoke every plausible rehost trigger BY NAME, re-enumerating before
  // each pick: mode-switch buttons (Standard, Scientific, ...) only exist
  // once the navigation pane is open, and rids change across rehosts.
  const seenTriggers = new Set<string>();
  for (let round = 0; round < 8; round++) {
    let t;
    try {
      const current = await backend.richTree();
      const btns = current.nodes.filter((n) => n.type === "Button" && n.enabled);
      t = btns.find(
        (b) =>
          !seenTriggers.has(b.name) &&
          /new tab|navigation|standard|scientific|graphing|programmer|date calculation|keep on top/i.test(b.name),
      );
    } catch (e) {
      timeline.push({ event: "enum-error", round, error: String(e instanceof Error ? e.message : e).slice(0, 140) });
      try {
        const wins = await backend.listWindows();
        const hit = wins.find((w) => /calcul/i.test(w.title));
        if (hit) await backend.attach({ pid: hit.pid });
        continue;
      } catch { break; }
    }
    if (!t) break;
    seenTriggers.add(t.name);
    let invokeError = "";
    try {
      await backend.invoke(t.id);
    } catch (e) {
      invokeError = String(e instanceof Error ? e.message : e).slice(0, 140);
    }
    timeline.push({ event: "invoked", name: t.name, error: invokeError || null });
    await sleep(1500);

    // Probe the tree repeatedly; classify what the backend returns.
    for (let probe = 0; probe < 5; probe++) {
      try {
        const tr = await backend.richTree();
        timeline.push({
          event: "probe",
          after: t.name,
          probe,
          nodes: tr.nodes.length,
          reattached: !!tr.reattached,
          modalBlocking: tr.modalBlocking ?? null,
        });
        // Re-baseline after a successful recovery so the NEXT trigger's
        // collapse heuristic compares against the CURRENT window, and keep
        // exploring from the fresh tree (rids change across rehosts).
        if (tr.reattached) break;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 160);
        timeline.push({ event: "probe-error", after: t.name, probe, error: msg });
        // The cached root may now point at a dead/rehosted HWND: re-resolve
        // by pid/title like attach does, then continue with the next trigger.
        try {
          const wins = await backend.listWindows();
          const hit = wins.find((w) => /calcul/i.test(w.title));
          if (hit) {
            await backend.attach({ pid: hit.pid });
            timeline.push({ event: "manual-reattach", pid: hit.pid });
          }
        } catch { /* next trigger will report */ }
        break;
      }
      await sleep(700);
    }
  }

  // Graceful close
  let closeOk = true;
  try { await backend.closeWindow(); } catch { closeOk = false; }
  const gone = await waitUntil(async () =>
    !(await backend.listWindows()).some((w) => w.pid === pid), 20000);
  timeline.push({ event: "close", closeOk, windowGone: gone, residualKilled: !(await killIfAlive(pid)) });

  function killIfAlive(p: number): Promise<boolean> {
    return new Promise((resolve) => {
      const chk = spawnSync("tasklist", ["/FI", `PID eq ${p}`, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15000 });
      if (!(chk.stdout ?? "").includes(`","${p}"`)) { resolve(false); return; }
      killPid(p);
      setTimeout(() => resolve(true), 1500);
    });
  }
} finally {
  bridge.dispose();
}

// Verdict semantics:
//   REGRESSION_BLIND_STUB      - a root-only stub came back WITHOUT error
//   FIX_COVERS_CF2_REATTACHED  - collapse detected AND recovery returned a full tree
//   REHOST_DETECTED_HONEST_FAILURE - collapse detected, bounded reattach failed
//     truthfully (target surface not enumerable after rehost on this build)
//   NO_COLLAPSE_OBSERVED       - no trigger fired this run
const probes = timeline.filter((t) => t.event === "probe") as { nodes: number; reattached: boolean }[];
const probeErrors = timeline.filter(
  (t) => (t.event === "probe-error" || t.event === "enum-error") &&
    /rehost suspected/i.test(String((t as { error?: string }).error ?? "")));
const blindStub = probes.some((p) => p.nodes <= 1 && !p.reattached);
const recovered = probes.some((p) => p.reattached && p.nodes > 1);
const rehostDetected = blindStub || recovered || probeErrors.length > 0;
const verdict = blindStub
  ? "REGRESSION_BLIND_STUB"
  : recovered
    ? "FIX_COVERS_CF2_REATTACHED"
    : probeErrors.length > 0
      ? "REHOST_DETECTED_HONEST_FAILURE"
      : "NO_COLLAPSE_OBSERVED";
void rehostDetected;
const out = { verdict, probes: probes.length, timeline };
writeFileSync(join(here, "calc-rehost-summary.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
