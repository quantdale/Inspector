/**
 * GA field soak: vim over the REAL PTY backend (@lydell/node-pty).
 * Multi-session unscripted exploration with lifecycle, Ctrl-C, external-kill,
 * and resource probes. Reuses production CliAdapterHandler + NodePtyBackend
 * unmodified; only concession is appending the target filename at spawn.
 *
 * Run from repo root:
 *   node --import tsx .inspector/ga-work/hunts/vim-pty/ga-soak.mjs [sessions] [stepsPerSession]
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodePtyBackend } from "../../../../packages/cli-adapter/src/node-pty-backend.js";
import { CliAdapterHandler } from "../../../../packages/cli-adapter/src/cli-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = join(here, "sandbox");
process.chdir(sandbox);

const SESSIONS = Number(process.argv[2] ?? 3);
const STEPS = Number(process.argv[3] ?? 80);

class VimBackend extends NodePtyBackend {
  async spawn(program) {
    const exe =
      program === "vim" ? "C:\\Program Files\\Git\\usr\\bin\\vim.exe" : program;
    return super.spawn(exe, ["scratch.txt"]);
  }
}

const hash = (lines) =>
  createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resourceSnapshot(tag) {
  const mu = process.memoryUsage();
  let vims = "?";
  try {
    const out = require("node:child_process")
      .execSync('tasklist /FI "IMAGENAME eq vim.exe" /FO CSV /NH')
      .toString()
      .trim();
    vims = out.includes("vim.exe") ? (out.match(/vim\.exe/g) ?? []).length : 0;
  } catch {
    /* tasklist unavailable */
  }
  return {
    tag,
    rssMB: Number((mu.rss / 1048576).toFixed(1)),
    heapUsedMB: Number((mu.heapUsed / 1048576).toFixed(1)),
    vimProcesses: vims,
    openHandlesApprox: process._getActiveHandles?.().length ?? null,
    requestsApprox: process._getActiveRequests?.().length ?? null,
  };
}

// ESM shim for the CJS-only child_process import inside resourceSnapshot.
import { createRequire } from "node:module";
const require0 = createRequire(import.meta.url);
const require = (m) => require0(m);

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
        runId: `ga-vim-soak-s${s}`,
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

  let boot = null;
  try {
    await handler.lifecycle({
      op: "create",
      options: { runId: `ga-vim-soak-s${s}`, environmentId: "env-vim" },
    });
    currentSessionId = `pty-${s}`;
    await sleep(700);
    boot = await observe();
    seen.add(boot.h);
  } catch (e) {
    sessionSummaries.push({ session: s, fatal: String(e) });
    break;
  }

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
    ["[200~ga-field-text[201~", "bracketed-paste"],
    ["[1;5C", "ctrl-right"],
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
  await act("[200~", "paste-start-normalize");
  await act("[201~", "paste-end-normalize");
  await act("gg", "goto-top");
  await act(`oga session ${s} was here`, "insert-entry-verified");
  await act(":w", "save-file");

  // Ctrl-C probe mid-insert
  await act("i", "enter-insert-for-ctrlc");
  await act("typing before interrupt", "type-mid-insert");
  const ctrlC = await act("", "ctrl-c-mid-insert");

  let killProbe = {};
  if (s === SESSIONS - 1) {
    const { execSync } = require("node:child_process");
    try {
      const out = execSync(
        'tasklist /FI "IMAGENAME eq vim.exe" /FO CSV /NH',
      ).toString();
      const m = out.match(/"vim\.exe","(\d+)"/);
      if (m) {
        execSync(`taskkill /F /PID ${m[1]}`);
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
          pid: m[1],
          alivePollsMs300: polls,
          aliveAfter: polls.at(-1),
          postKillStatus: postKillAct.status ?? postKillAct.threw,
          postKillError: postKillAct.error ?? null,
        };
      }
    } catch (e) {
      killProbe = { error: String(e) };
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

  sessionSummaries.push({
    session: s,
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
  });
  resources.push(resourceSnapshot(`after-session-${s}`));
}

writeFileSync(
  join(here, "ga-summary.json"),
  JSON.stringify(
    { sessions: SESSIONS, stepsPerSession: STEPS, sessionSummaries, resources },
    null,
    2,
  ),
);
console.log(JSON.stringify({ sessionSummaries, resources }, null, 1));
