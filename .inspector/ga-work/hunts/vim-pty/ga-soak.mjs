/**
 * GA field soak: vim over the REAL PTY backend (@lydell/node-pty).
 * Multi-session unscripted exploration with lifecycle, Ctrl-C, external-kill,
 * and resource probes. Reuses production CliAdapterHandler + NodePtyBackend
 * unmodified; only concession is appending the target filename at spawn.
 *
 * Portability: vim path + sandbox are discovered/generated at run time (env:
 * GA_VIM_EXE). Orphan detection is PID-ANCESTRY based: each session snapshots
 * vim.exe PIDs before spawn and attributes the post-spawn delta to itself,
 * then polls THOSE PIDs after close. The machine-global count is recorded
 * only as secondary context.
 *
 * Run from repo root:
 *   node --import tsx .inspector/ga-work/hunts/vim-pty/ga-soak.mjs [sessions] [stepsPerSession]
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { NodePtyBackend } from "../../../../packages/cli-adapter/src/node-pty-backend.js";
import { CliAdapterHandler } from "../../../../packages/cli-adapter/src/cli-adapter.js";
import { resolveVimExe, imagePids, pidAlive } from "../../tools/discovery.mjs";

const require0 = createRequire(import.meta.url);
const require = (m) => require0(m);
const { execSync } = require("node:child_process");

const here = dirname(fileURLToPath(import.meta.url));
const VIM_EXE = resolveVimExe();

// Deterministic scratch target, generated per run OUTSIDE source control.
// IMPORTANT: the sandbox MUST be a long path. os.tmpdir() resolves to the
// 8.3 short form (C:\Users\MICHAE~1\...) on this machine, and spawning any
// program through ConPTY with a short-path cwd hard-crashes node-pty
// natively (exit 0xFFFFFFFF, no output). Repo-relative .inspector/tmp is
// gitignored and always long.
const REPO_TMP = join(here, "..", "..", "..", "..", ".inspector", "tmp");
mkdirSync(REPO_TMP, { recursive: true });
const sandbox = mkdtempSync(join(REPO_TMP, "ga-vim-sandbox-"));
const SCRATCH_SEED = [
  "ga field soak target",
  "line two",
  "line three",
  "",
].join("\n");
writeFileSync(join(sandbox, "scratch.txt"), SCRATCH_SEED);
process.chdir(sandbox);

const SESSIONS = Number(process.argv[2] ?? 3);
const STEPS = Number(process.argv[3] ?? 80);

class VimBackend extends NodePtyBackend {
  async spawn(program) {
    return super.spawn(program === "vim" ? VIM_EXE : program, ["scratch.txt"]);
  }
}

const hash = (lines) =>
  createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resourceSnapshot(tag, sessionPids = []) {
  const mu = process.memoryUsage();
  const vims = imagePids("vim.exe");
  return {
    tag,
    rssMB: Number((mu.rss / 1048576).toFixed(1)),
    heapUsedMB: Number((mu.heapUsed / 1048576).toFixed(1)),
    vimProcessesGlobalCount: vims.length, // secondary context only
    sessionPidsAlive: sessionPids.filter(pidAlive), // authoritative orphan metric
    openHandlesApprox: process._getActiveHandles?.().length ?? null,
    requestsApprox: process._getActiveRequests?.().length ?? null,
  };
}

/** PIDs that appeared between two snapshots => this session's vim. */
function sessionPids(before, after) {
  return after.filter((p) => !before.includes(p));
}

/** Poll specific PIDs until gone; returns {reapedMs, residualPids}. */
async function awaitReap(pids, timeoutMs = 10000) {
  const t0 = Date.now();
  let pending = [...pids];
  while (Date.now() - t0 < timeoutMs && pending.length > 0) {
    await sleep(200);
    pending = pending.filter(pidAlive);
  }
  return { reapedMs: Date.now() - t0, residualPids: pending };
}

const backend = new VimBackend();
const resources = [resourceSnapshot("boot")];
const sessionSummaries = [];

for (let s = 0; s < SESSIONS; s++) {
  const artifacts = mkdtempSync(join(here, "artifacts-ga-"));
  const handler = new CliAdapterHandler(backend, artifacts, "vim");
  let seq = 0;
  let currentSessionId = `pty-${s}`;
  const seen = new Set();
  const log = [];

  async function observe() {
    const obs = await handler.observe();
    const lines = obs.summary.uiTree
      .filter((n) => n.id.startsWith("line-"))
      .map((n) => n.text);
    return { h: hash(lines) };
  }

  async function act(value, label) {
    const outcome = await handler.act({
      action: {
        kind: "fill",
        id: `act-s${s}-${seq}`,
        runId: `ga_vim_soak_s${s}`,
        environmentId: "env-vim",
        input: { value },
      },
    });
    await sleep(300);
    const { h } = await observe();
    const novelty = seen.has(h) ? "seen" : "new";
    seen.add(h);
    log.push({
      seq: seq++,
      action: label ?? JSON.stringify(value),
      status: outcome.status,
      error: outcome.error ?? null,
      screenHash: h,
      novelty,
    });
    return log[log.length - 1];
  }

  const pidsBefore = imagePids("vim.exe");
  let boot = null;
  try {
    await handler.lifecycle({
      op: "create",
      options: { runId: `ga_vim_soak_s${s}`, environmentId: "env-vim" },
    });
    currentSessionId = `pty-${s}`;
    await sleep(700);
    boot = await observe();
    seen.add(boot.h);
  } catch (e) {
    sessionSummaries.push({ session: s, fatal: String(e) });
    break;
  }
  const myVimPids = sessionPids(pidsBefore, imagePids("vim.exe"));

  const pool = [
    ["j", "down"],
    ["k", "up"],
    ["0", "col-0"],
    ["$", "col-end"],
    ["gg", "goto-top"],
    ["G", "goto-bottom"],
    ["x", "delete-char"],
    ["u", "undo"],
    ["dd", "delete-line"],
    ["i", "insert-mode"],
    ["\x1b[200~ga-field-text\x1b[201~", "bracketed-paste"],
    ["\x1b[1;5C", "ctrl-right"],
    ["a", "append"],
    ["o", "open-line"],
    ["ga soak text ", "text-token"],
    ["w", "word-fwd"],
    ["b", "word-back"],
    ["/soak\r", "search-fwd"],
    ["n", "search-next"],
    ["~", "toggle-case"],
  ];
  const scores = new Map(pool.map(([, l]) => [l, 0]));

  for (let step = 0; step < STEPS; step++) {
    let best = null;
    for (const [key, label] of pool) {
      const sc = scores.get(label);
      if (!best || sc > best.s) best = { key, label, s: sc };
    }
    const r = await act(best.key, best.label);
    scores.set(best.label, best.s + (r.novelty === "new" ? 1 : -2));
    if (!(await backend.isAlive(currentSessionId))) break;
  }

  // coverage: verified insert + save every session
  await act("\x1b[200~", "paste-start-normalize");
  await act("\x1b[201~", "paste-end-normalize");
  await act("gg", "goto-top");
  await act(`oga session ${s} was here`, "insert-entry-verified");
  await act(":w", "save-file");

  // Ctrl-C probe mid-insert
  await act("i", "enter-insert-for-ctrlc");
  await act("typing before interrupt", "type-mid-insert");
  const ctrlC = await act("\x03", "ctrl-c-mid-insert");

  let killProbe = {};
  if (s === SESSIONS - 1) {
    if (myVimPids.length > 0) {
      execSync(`taskkill /F /PID ${myVimPids[0]}`);
      const polls = [];
      for (let i = 0; i < 10; i++) {
        await sleep(300);
        polls.push(await backend.isAlive(currentSessionId));
        if (!polls.at(-1)) break;
      }
      const postKillAct = await act("j", "act-after-external-kill").catch(
        (e) => ({ threw: String(e) }),
      );
      killProbe = {
        pid: myVimPids[0],
        alivePollsMs300: polls,
        aliveAfter: polls.at(-1),
        postKillStatus: postKillAct.status ?? postKillAct.threw,
        postKillError: postKillAct.error ?? null,
      };
    } else {
      killProbe = { error: "no session-attributable vim pid" };
    }
  }

  let closeResult = null;
  let closeError = null;
  try {
    closeResult = await handler.lifecycle({ op: "close" });
  } catch (e) {
    closeError = String(e);
  }
  const aliveAfterClose = await backend.isAlive(currentSessionId);
  const reap = await awaitReap(myVimPids);

  sessionSummaries.push({
    session: s,
    vimExe: VIM_EXE,
    sessionVimPids: myVimPids,
    interactions: log.length,
    novelScreens: seen.size,
    nonSuccessActions: log
      .filter((r) => r.status !== "success")
      .map((r) => [r.seq, r.action, r.status, r.error]),
    ctrlCStatus: ctrlC.status,
    ctrlCError: ctrlC.error ?? null,
    killProbe,
    closeResult,
    closeError,
    aliveAfterClose,
    reap: { ...reap, residualAlive: reap.residualPids.map((p) => pidAlive(p)) },
  });
  resources.push(resourceSnapshot(`after-session-${s}`, myVimPids));
}

// Final verdict inputs: every session's own vim PIDs must be reaped.
const allSessionPids = sessionSummaries.flatMap((x) => x.sessionVimPids ?? []);
const summary = {
  sessions: SESSIONS,
  stepsPerSession: STEPS,
  vimExe: VIM_EXE,
  sandbox,
  orphanVerdict:
    allSessionPids.some(pidAlive)
      ? "RESIDUAL_PIDS"
      : allSessionPids.length === 0
        ? "UNVERIFIED_NO_PIDS_ATTRIBUTED"
        : "ALL_SESSION_PIDS_REAPED",
  sessionSummaries,
  resources,
};
writeFileSync(join(here, "ga-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
