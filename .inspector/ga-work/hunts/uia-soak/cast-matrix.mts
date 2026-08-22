/**
 * GA P6 classification matrix for the UIA "Specified cast is not valid."
 * invoke failure. Drives the PRODUCTION RealUiaBackend against Notepad and,
 * on each failure, escalates recovery one bounded step at a time:
 *   A. immediate same-bridge retry of the same rid
 *   B. detach + attach (fresh cached window root, SAME PowerShell session)
 *   C. bridge dispose + new bridge + attach (fresh PS/.NET UIA session)
 *
 * The step that recovers invocation classifies the root cause:
 *   A succeeds -> transient provider hiccup
 *   B succeeds -> stale CACHED WINDOW ROOT in the long-lived bridge (product fixable)
 *   C needed   -> PS/.NET UIA session corruption (restart is the only cure)
 *   none       -> app-specific broken pattern advertisement
 *
 * Run from repo root:
 *   node --import tsx .inspector/ga-work/hunts/uia-soak/cast-matrix.mts [maxInteractions]
 */
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RealUiaBackend } from "../../../../packages/windows-adapter/src/real-uia.js";
import { PowerShellUiaBridge } from "../../../../packages/windows-adapter/src/uia-bridge.js";
import type { UiaRichNode } from "../../../../packages/windows-adapter/src/real-uia.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_INTERACTIONS = Number(process.argv[2] ?? 60);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newBridge() {
  return new PowerShellUiaBridge({ timeoutMs: 15000 });
}
let bridge = newBridge();
let backend = new RealUiaBackend(bridge);

function notepadPids(): number[] {
  const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq Notepad.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15000 });
  const pids: number[] = [];
  for (const line of (out.stdout ?? "").split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m && /notepad/i.test(m[1]!)) pids.push(Number(m[2]));
  }
  return pids;
}

async function launchNotepad(): Promise<number> {
  const before = new Set(notepadPids());
  spawn("cmd", ["/c", "start", "", "notepad"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const fresh = notepadPids().filter((p) => !before.has(p));
    if (fresh.length > 0) return fresh[0]!;
  }
  throw new Error("notepad never appeared");
}

async function killTree(pid: number) {
  try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15000 }); } catch {}
}

interface EventRow {
  step: number;
  pick: string;
  kind: string;
  result: string;
  error?: string;
  recoveredBy?: "A-retry" | "B-reattach-same-session" | "C-new-bridge" | "none";
}

async function candidates(): Promise<UiaRichNode[]> {
  const tree = await backend.richTree();
  return tree.nodes.filter(
    (n) =>
      n.enabled &&
      !n.offscreen &&
      n.type !== "Edit" &&
      !/^minimize|^maximize|^close$/i.test(n.name.trim()) &&
      !/file|open|save|print|exit|about|replace|goto|find|settings/i.test(n.name) &&
      (n.patterns.some((p) => p.includes("InvokePattern")) ||
        n.patterns.some((p) => p.includes("TogglePattern"))),
  );
}

const events: EventRow[] = [];
const invokedCounts = new Map<string, number>();
let castErrors = 0;

const pid = await launchNotepad();
await sleep(1500);
const wins = await backend.listWindows();
const win = wins.find((w) => w.pid === pid)!;
await backend.attach({ pid: win.pid });

for (let step = 0; step < MAX_INTERACTIONS; step++) {
  let pool: UiaRichNode[];
  try {
    pool = await candidates();
  } catch (e) {
    events.push({ step, pick: "(tree)", kind: "richTree", result: "failed", error: String(e).slice(0, 140) });
    break;
  }
  if (pool.length === 0) {
    events.push({ step, pick: "(pool)", kind: "-", result: "empty-pool" });
    break;
  }
  pool.sort((a, b) => (invokedCounts.get(a.id) ?? 0) - (invokedCounts.get(b.id) ?? 0));
  const pick = pool[0]!;
  invokedCounts.set(pick.id, (invokedCounts.get(pick.id) ?? 0) + 1);
  const kind = pick.patterns.some((p) => p.includes("InvokePattern")) ? "invoke" : "toggle";
  const row: EventRow = { step, pick: `${pick.type}"${pick.name}"`, kind, result: "ok" };

  const attempt = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (kind === "invoke") await backend.invoke(pick.id);
      else await backend.toggle(pick.id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) };
    }
  };

  let r = await attempt();
  if (!r.ok && /cast is not valid/i.test(r.error ?? "")) {
    castErrors++;
    row.result = "cast-error";
    row.error = r.error;
    // A: same-bridge retry
    r = await attempt();
    if (r.ok) {
      row.recoveredBy = "A-retry";
    } else {
      // B: reattach within the SAME PowerShell session
      try {
        await backend.detach();
        await backend.attach({ pid: win.pid });
        r = await attempt();
        if (r.ok) row.recoveredBy = "B-reattach-same-session";
      } catch (e) {
        row.error = `${row.error} | B failed: ${String(e).slice(0, 120)}`;
      }
      if (!r.ok) {
        // C: full new bridge/session
        try {
          bridge.dispose();
          await sleep(1000);
          bridge = newBridge();
          backend = new RealUiaBackend(bridge);
          await backend.attach({ pid: win.pid });
          r = await attempt();
          if (r.ok) row.recoveredBy = "C-new-bridge";
        } catch (e) {
          row.error = `${row.error} | C failed: ${String(e).slice(0, 120)}`;
        }
        if (!r.ok && !row.recoveredBy) row.recoveredBy = "none";
      }
    }
  } else if (!r.ok) {
    row.result = "other-error";
    row.error = r.error;
  }
  events.push(row);
  await sleep(350);
}

await killTree(pid);
bridge.dispose();

const byRecovery = events.reduce<Record<string, number>>((acc, e) => {
  if (e.recoveredBy) acc[e.recoveredBy] = (acc[e.recoveredBy] ?? 0) + 1;
  return acc;
}, {});
const summary = {
  pid,
  interactions: events.length,
  castErrors,
  otherErrors: events.filter((e) => e.result === "other-error").length,
  okCount: events.filter((e) => e.result === "ok").length,
  byRecovery,
  classification:
    castErrors === 0
      ? "NOT_REPRODUCED_THIS_RUN"
      : (byRecovery["A-retry"] ?? 0) > 0
        ? "TRANSIENT_PROVIDER_HICCUP"
        : (byRecovery["B-reattach-same-session"] ?? 0) > 0
          ? "STALE_CACHED_WINDOW_ROOT"
          : (byRecovery["C-new-bridge"] ?? 0) > 0
            ? "PS_SESSION_CORRUPTION"
            : "APP_BROKEN_PATTERN",
  events,
};
writeFileSync(join(here, "cast-matrix-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(
  { pid, interactions: summary.interactions, castErrors, otherErrors: summary.otherErrors, okCount: summary.okCount, byRecovery, classification: summary.classification },
  null, 1,
));
