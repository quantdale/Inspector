import { RunManager } from "@inspector/core";
import type { Action } from "@inspector/protocol";
import { parseArgs, CliError } from "./args.js";
import type { ParsedInvocation } from "./args.js";
import { commandHelp, generalUsage } from "./help.js";
import { resolveVersion } from "./version.js";
import { runDoctorProbes, renderDoctorReport } from "./doctor.js";
import { huntCommand, warnRepoRootWorkspace, workDirOf, type CommandContext } from "./hunt.js";
import { findingsCommand } from "./findings.js";
import { runsCommand } from "./runs.js";
import { adapterSpawn, openWorkspace, remapWorkspaceConflict } from "./workspace.js";

// Public workspace/spawn helpers re-exported for library consumers.
export { openWorkspace, adapterSpawn, workspaceDirFrom } from "./workspace.js";
export type { Workspace, AdapterSpawnSpec } from "./workspace.js";

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return { id, runId: "run", environmentId: "env", kind, risk: "interact", deadlineMs: 5000, idempotency: "safe-retry", input };
}

export interface CliResult {
  code: number;
  data?: unknown;
}

interface CommandSplit {
  command: string | null;
  rest: string[];
  workspaceArg?: string;
}

/** Find the command token without rejecting flags yet (help/version first). */
function splitCommand(argv: string[]): CommandSplit {
  const rest: string[] = [];
  let command: string | null = null;
  let workspaceArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (command === null) {
      if (token === "--") continue;
      if (token === "--workspace") {
        const value = argv[i + 1];
        if (value !== undefined) {
          workspaceArg = value;
          i += 1;
        }
        continue;
      }
      if (token.startsWith("-") && token.length > 1) continue;
      command = token;
    } else {
      rest.push(token);
    }
  }
  return { command, rest, workspaceArg };
}

export async function runCli(argv: string[], cwd: string = process.cwd()): Promise<CliResult> {
  // --version wins over everything.
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${resolveVersion()}\n`);
    return { code: 0 };
  }

  const { command, rest, workspaceArg } = splitCommand(argv);
  const json = argv.includes("--json");
  const out = (line: string): void => {
    process.stdout.write(line + "\n");
  };
  const progress = (line: string): void => {
    if (!json) process.stderr.write(line + "\n");
  };

  // Help: explicit flag anywhere or the help command (even without a target).
  const helpRequested = argv.includes("--help") || argv.includes("-h");
  if (command === null && !helpRequested) {
    out(generalUsage());
    return { code: 1 };
  }
  if (helpRequested || command === "help") {
    const target = command === "help" ? (rest[0] ?? "") : command!;
    out(target === "" ? generalUsage() : commandHelp(target));
    return { code: 0 };
  }

  const ctx: CommandContext = { baseCwd: cwd, workspaceArg, json, out, progress };

  switch (command) {
    case "doctor":
      return doctorCommand(rest, ctx);
    case "hunt":
      return huntCommand(parseArgs(rest, ["--adapter", "--url", "--target", "--seed", "--max-actions", "--max-minutes", "--max-findings", "--resume"], []), ctx);
    case "run":
      return runDemo(parseArgs(rest, ["--adapter"], []), ctx);
    case "runs":
      return runsCommand(rest, ctx);
    case "findings":
      return findingsCommand(rest, ctx);
    case "version":
      out(resolveVersion());
      return { code: 0 };
    default:
      throw new CliError("unknown-command", `${command} (try 'inspector --help')`);
  }
}

async function doctorCommand(rest: string[], ctx: CommandContext): Promise<CliResult> {
  // doctor takes no command-specific flags; parseArgs still validates them.
  const parsed = parseArgs(rest, [], []);
  const workDir = workDirOf(ctx, parsed);
  const warning = warnRepoRootWorkspace(ctx, workDir);
  const checks = await runDoctorProbes(workDir);
  const failedRequired = checks.filter((c) => !c.ok && c.required).length;
  if (ctx.json) {
    ctx.out(
      JSON.stringify(
        {
          ok: failedRequired === 0,
          ...(warning !== null ? { warning } : {}),
          workspace: workDir,
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    ctx.out(renderDoctorReport(checks));
  }
  return { code: failedRequired === 0 ? 0 : 1, data: { ok: failedRequired === 0, checks } };
}

/** Legacy scripted demonstration (kept for compatibility with RC0 usage). */
async function runDemo(parsed: ParsedInvocation, ctx: CommandContext): Promise<CliResult> {
  const adapterArg = parsed.flags["--adapter"];
  if (adapterArg === undefined || adapterArg === true) {
    throw new CliError("missing-value", "--adapter requires a value (fake|web)");
  }
  if (adapterArg !== "fake" && adapterArg !== "web") {
    ctx.out("only --adapter fake|web is supported");
    return { code: 1 };
  }
  const dir = workDirOf(ctx, parsed);
  warnRepoRootWorkspace(ctx, dir);
  let store, artifacts;
  try {
    ({ store, artifacts } = openWorkspace(dir));
  } catch (e) {
    throw remapWorkspaceConflict(e);
  }
  try {
    const mgr = new RunManager(store, artifacts);
    let run;
    try {
      run = await mgr.startRun(adapterSpawn(adapterArg));
    } catch (e) {
      throw remapWorkspaceConflict(e);
    }
    const steps: unknown[] = [];

    if (adapterArg === "fake") {
      for (const a of [act("d1", "openForm"), act("d2", "fillField", { name: "default", value: "ok" }), act("d3", "submit")]) {
        const r = await run.submitAction(a);
        steps.push({ id: a.id, outcome: (r as { outcome?: unknown }).outcome });
      }
      await run.observe(["state"]);
      await run.reset();
      await run.submitAction(act("d4", "openForm"));
      await run.submitAction(act("d5", "fillField", { name: "default", value: "BAD" }));
      const fail = await run.submitAction(act("d6", "submit"));
      const summary = {
        runId: run.runId,
        adapter: "fake",
        deterministicFailure: (fail as { outcome?: { status: string } }).outcome?.status ?? "none",
      };
      ctx.out(ctx.json ? JSON.stringify(summary, null, 2) : `run ${summary.runId} complete; deterministicFailure=${summary.deterministicFailure}`);
      await run.close();
      return { code: 0, data: summary };
    }

    // Web traversal of the seeded target.
    await run.submitAction(act("w1", "fill", { selector: "#username", value: "admin" }));
    await run.submitAction(act("w2", "fill", { selector: "#password", value: "admin" }));
    await run.submitAction(act("w3", "click", { selector: "#loginBtn" }));
    const obs1 = await run.observe(["url", "uiTree"]);
    await run.submitAction(act("w4", "click", { selector: "#increment" }));
    await run.submitAction(act("w5", "click", { selector: "#save" }));
    const obs2 = await run.observe(["storage", "screenshot", "console", "network", "trace"]);
    // Deterministic target crash (boom button) -> target-failure, not adapter crash.
    const crash = await run.submitAction(act("w6", "click", { selector: "#boom" }));
    // Forbidden origin navigation must be rejected by policy/adapter.
    const forbidden = await run.submitAction(act("w7", "navigate", { value: "https://evil.example.com/secret" }));
    const obs3 = await run.observe(["url", "pageErrors"]);
    const uiTree = (obs1.summary as { uiTree?: Array<{ id: string; hidden?: boolean }> }).uiTree ?? [];
    const incrementNode = uiTree.find((e) => e.id === "increment");
    const summary = {
      runId: run.runId,
      adapter: "web",
      reachedDashboard: incrementNode ? incrementNode.hidden === false : false,
      savedPreference: ((obs2.summary as { storage?: Record<string, string> }).storage?.["pref"] ?? "").startsWith("saved-"),
      boomOutcome: (crash as { outcome?: { status: string } }).outcome?.status ?? "none",
      forbiddenOutcome: (forbidden as { outcome?: { status: string } }).outcome?.status ?? "none",
      pageErrorsAfterBoom: ((obs3.summary as { pageErrors?: Array<{ message: string }> }).pageErrors ?? []).length,
    };
    ctx.out(ctx.json ? JSON.stringify(summary, null, 2) : `run ${summary.runId} complete; dashboard=${summary.reachedDashboard}; pref=${summary.savedPreference}; boom=${summary.boomOutcome}; forbidden=${summary.forbiddenOutcome}`);
    await run.close();
    return { code: 0, data: summary };
  } finally {
    store.close();
  }
}
