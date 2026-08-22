/**
 * GA Phase 15 soak: web pageerror/action-window attribution under varied
 * scheduling. Repeats each scenario shape N times and verifies classification:
 *
 *   S1 pre-action crash          -> ACTION_FAILED   (K2 discipline)
 *   S2 crash during FAILING act  -> TARGET_FAILURE  (K1 discipline)
 *   S3 crash during SUCCESS act  -> success stays success (no over-attribute)
 *                                   OR honest TARGET_FAILURE if inside window;
 *                                   must NEVER be ACTION_FAILED-with-crash-swallowed
 *   S4 crash in settle window    -> TARGET_FAILURE  (D3)
 *   S5 navigation during action  -> resolves within deadline, no hang
 *   S6 console.error storm + delayed pageerror overlap -> drained, classified
 *
 * Run from repo root:
 *   node --import tsx .inspector/ga-work/hunts/web-attribution/ga-web-window-soak.mts [repsPerScenario]
 */
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Action } from "../../../../packages/protocol/src/messages.js";
import { WebAdapterHandler } from "../../../../packages/adapter-web/src/web-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPS = Number(process.argv[2] ?? 12);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-scenario wall-clock samples for the timing-distribution requirement. */
const timings: Record<string, number[]> = {};
async function timed(label: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
  } finally {
    (timings[label] ??= []).push(Date.now() - t0);
  }
}

function act(
  id: string,
  kind: string,
  input?: Record<string, unknown>,
  deadlineMs = 8000,
): Action {
  return {
    id,
    runId: "ga-web-window",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs,
    idempotency: "safe-retry",
    input,
  } as Action;
}

const ART_BASE = mkdtempSync(join(tmpdir(), "ga-web-window-"));
let handler: WebAdapterHandler | null = null;

async function fresh(seedHtml: string): Promise<WebAdapterHandler> {
  handler = new WebAdapterHandler(
    {},
    join(ART_BASE, `art-${Math.random().toString(36).slice(2)}`),
    seedHtml,
  );
  await handler.lifecycle({ op: "create" });
  return handler;
}

async function close() {
  if (handler) {
    await handler.lifecycle({ op: "close" }).catch(() => {});
    handler = null;
  }
}

interface Row {
  scenario: string;
  rep: number;
  ok: boolean;
  detail: string;
}
const rows: Row[] = [];

// ---- S1: pre-action crash must stay ACTION_FAILED (K2) --------------------
async function s1(rep: number): Promise<void> {
  const h = await fresh(`<!doctype html><html><body><script>
    setTimeout(function () { throw new Error('PreActionCrash'); }, 20);
  </script></body></html>`);
  try {
    await sleep(300); // crash lands well before the action starts
    const outcome = await h.act({
      action: act(`s1-${rep}`, "click", { selector: "#missing" }, 5000),
    });
    // The earlier crash must NOT leak into this action's outcome.
    const leaked =
      outcome.status === "target-failure" &&
      String(outcome.error?.message ?? "").includes("PreActionCrash");
    rows.push({
      scenario: "S1-pre-action-stays-ACTION_FAILED",
      rep,
      ok: !leaked,
      detail: `${outcome.status}${outcome.error ? ":" + outcome.error.code : ""}${leaked ? " LEAKED" : ""}`,
    });
  } finally {
    await close();
  }
}

// ---- S2: crash during failing action -> TARGET_FAILURE (K1) ---------------
async function s2(rep: number): Promise<void> {
  const h = await fresh(`<!doctype html><html><body><script>
    setTimeout(function () { throw new Error('ConcurrentCrash${rep}'); }, 2000);
  </script></body></html>`);
  try {
    const outcome = await h.act({
      action: act(`s2-${rep}`, "click", { selector: "#does-not-exist" }, 12000),
    });
    const ok =
      outcome.status === "target-failure" &&
      outcome.error?.code === "TARGET_FAILURE" &&
      String(outcome.error?.message ?? "").includes(`ConcurrentCrash${rep}`);
    rows.push({
      scenario: "S2-during-failing->TARGET_FAILURE",
      rep,
      ok,
      detail: `${outcome.status}:${outcome.error?.code ?? "-"}`,
    });
  } finally {
    await close();
  }
}

// ---- S3: crash while a SUCCESSFUL action completes ------------------------
// The click succeeds; the crash arrives right around completion. Either the
// action reports success (crash attributed to the NEXT observation/settle) or
// target-failure carrying the crash — but never a silent swallow with no trace.
async function s3(rep: number): Promise<void> {
  const h =
    await fresh(`<!doctype html><html><body><button id="b">ok</button><script>
    setTimeout(function () { throw new Error('BoundaryCrash'); }, 150);
  </script></body></html>`);
  try {
    const outcome = await h.act({
      action: act(`s3-${rep}`, "click", { selector: "#b" }, 8000),
    });
    const statusOk =
      outcome.status === "success" || outcome.status === "target-failure";
    rows.push({
      scenario: "S3-boundary-crash-no-hang",
      rep,
      ok: statusOk,
      detail: `${outcome.status}:${outcome.error?.code ?? "-"}`,
    });
  } finally {
    await close();
  }
}

// ---- S4: crash inside settle window after action -> TARGET_FAILURE (D3) ---
// Default settleMs is 50ms. A throw at ~20ms must land inside the window.
async function s4(rep: number): Promise<void> {
  const h =
    await fresh(`<!doctype html><html><body><button id="b">ok</button><script>
    document.getElementById("b").addEventListener("click", function () {
      setTimeout(function () { throw new Error('SettleCrash'); }, 20);
    });
  </script></body></html>`);
  try {
    const outcome = await h.act({
      action: act(`s4-${rep}`, "click", { selector: "#b" }, 8000),
    });
    const ok =
      outcome.status === "target-failure" &&
      String(outcome.error?.message ?? "").includes("SettleCrash");
    rows.push({
      scenario: "S4-settle-window-crash(20ms-in-50ms)",
      rep,
      ok,
      detail: `${outcome.status}:${outcome.error?.code ?? "-"}`,
    });
  } finally {
    await close();
  }
}

async function s4b(rep: number): Promise<void> {
  const h =
    await fresh(`<!doctype html><html><body><button id="b">ok</button><script>
    document.getElementById("b").addEventListener("click", function () {
      setTimeout(function () { throw new Error('LateCrash'); }, 300);
    });
  </script></body></html>`);
  try {
    const outcome = await h.act({
      action: act(`s4b-${rep}`, "click", { selector: "#b" }, 8000),
    });
    // Pinned characterization (known limitation): beyond the settle window
    // the outcome reads success. Verifying the documented behavior holds.
    const ok = outcome.status === "success";
    rows.push({
      scenario: "S4b-beyond-settle-reads-success(pinned)",
      rep,
      ok,
      detail: `${outcome.status}:${outcome.error?.code ?? "-"}`,
    });
  } finally {
    await close();
  }
}

// ---- S5: navigation during action ------------------------------------------
async function s5(rep: number): Promise<void> {
  const h = await fresh(`<!doctype html><html><body><script>
    setTimeout(function () { location.href = location.pathname + '?nav=${rep}'; }, 400);
  </script></body></html>`);
  try {
    const t0 = Date.now();
    const outcome = await h.act({
      action: act(`s5-${rep}`, "click", { selector: ".never-there" }, 9000),
    });
    const elapsed = Date.now() - t0;
    rows.push({
      scenario: "S5-navigation-during-action-bounded",
      rep,
      ok:
        elapsed < 15000 &&
        ["action-failed", "target-failure"].includes(outcome.status),
      detail: `${outcome.status} in ${elapsed}ms`,
    });
  } finally {
    await close();
  }
}

// ---- S6: console.error storm + delayed pageerror overlap ------------------
async function s6(rep: number): Promise<void> {
  const h =
    await fresh(`<!doctype html><html><body><button id="b">go</button><script>
    document.getElementById("b").addEventListener("click", function () {
      for (let i = 0; i < 50; i++) { console.error("storm-" + i); }
      setTimeout(function () { throw new Error('StormCrash'); }, 15);
    });
  </script></body></html>`);
  try {
    const outcome = await h.act({
      action: act(`s6-${rep}`, "click", { selector: "#b" }, 8000),
    });
    const ok =
      outcome.status === "target-failure" &&
      String(outcome.error?.message ?? "").includes("StormCrash");
    rows.push({
      scenario: "S6-error-storm-overlap",
      rep,
      ok,
      detail: `${outcome.status}:${outcome.error?.code ?? "-"}`,
    });
  } finally {
    await close();
  }
}

for (let rep = 1; rep <= REPS; rep++) {
  await timed("S1-pre-action-stays-ACTION_FAILED", () => s1(rep));
  await timed("S2-during-failing->TARGET_FAILURE", () => s2(rep));
  await timed("S3-boundary-crash-no-hang", () => s3(rep));
  await timed("S4-settle-window-crash(20ms-in-50ms)", () => s4(rep));
  await timed("S4b-beyond-settle-reads-success(pinned)", () => s4b(rep));
  await timed("S5-navigation-during-action-bounded", () => s5(rep));
  await timed("S6-error-storm-overlap", () => s6(rep));
  process.stdout.write(`rep ${rep}/${REPS}\n`);
}
rmSync(ART_BASE, { recursive: true, force: true });

const fails = rows.filter((r) => !r.ok);
const byScenario: Record<string, { pass: number; fail: number }> = {};
for (const r of rows) {
  byScenario[r.scenario] ??= { pass: 0, fail: 0 };
  if (r.ok) byScenario[r.scenario]!.pass += 1;
  else byScenario[r.scenario]!.fail += 1;
}
const dist = (xs: number[]) => ({
  n: xs.length,
  min: Math.min(...xs),
  p50: xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)],
  max: Math.max(...xs),
});
const timingDistribution = Object.fromEntries(
  Object.entries(timings).map(([k, v]) => [k, dist(v)]),
);
const summaryJson = {
  reps: REPS,
  total: rows.length,
  failed: fails.length,
  byScenario,
  timingDistributionMs: timingDistribution,
  failures: fails.slice(0, 12),
};
writeFileSync(join(here, "ga-web-summary.json"), JSON.stringify(summaryJson, null, 2));
console.log(JSON.stringify(summaryJson, null, 1));
process.exit(fails.length > 0 ? 1 : 0);
