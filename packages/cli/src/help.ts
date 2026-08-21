/** Usage text for every command, kept in one place. */

const GLOBAL = [
  "Global flags:",
  "  --json                Machine-readable JSON output",
  "  --workspace <dir>     Workspace directory (default: <cwd>/.inspector)",
  "  --debug               Print raw stack traces after errors",
  "  --version, -v         Print the Inspector version",
  "  --help, -h            Show help for a command",
].join("\n");

export function generalUsage(): string {
  return [
    "inspector - autonomous, durable environment inspection and defect discovery",
    "",
    "Usage: inspector <command> [flags]",
    "",
    "Commands:",
    "  doctor                   Probe platform capabilities and workspace health",
    "  hunt                     Unscripted autonomous exploration against a target",
    "  run                      Scripted demonstration scenario (fake|web adapters)",
    "  runs list|show|resume    Inspect and re-attach to recorded runs",
    "  findings list|show       Inspect discovered findings and evidence bundles",
    "  help [command]           Show help",
    "",
    GLOBAL,
    "",
    "Examples:",
    "  inspector doctor --json",
    "  inspector hunt --adapter web --max-actions 100 --max-minutes 5",
    "  inspector hunt --adapter web --url http://127.0.0.1:3000/ --seed 7",
    "  inspector hunt --adapter fake --max-actions 60 --json",
    "  inspector findings list --limit 20",
    "  inspector findings show find_abc123",
    "  inspector runs list",
    "  inspector runs resume run_abc123",
  ].join("\n");
}

const COMMAND_HELP: Record<string, string> = {
  doctor: [
    "Usage: inspector doctor [--json] [--workspace <dir>]",
    "",
    "Probes the local platform and reports {ok, detail, remediation} per check.",
    "Core checks (node >= 22, workspace writable, store opens, fake adapter",
    "resolvable) must pass; optional capability probes (web/Playwright, pty,",
    "android adb, windows-uia, electron) are reported as WARN when missing.",
    "",
    "Exit code 0 only when all core checks pass.",
  ].join("\n"),
  hunt: [
    "Usage: inspector hunt [--adapter web|fake] [options]",
    "",
    "Unscripted autonomous exploration: discovers anomalies, reproduces them,",
    "and writes evidence bundles under <workspace>/bundles/<runId>/.",
    "",
    "Options:",
    "  --adapter web|fake     Target adapter (default: web)",
    "  --url <u>              Web only: external localhost http(s) target",
    "                         (validated; forwarded via WEB_TARGET_URL)",
    "  --seed <n>             Deterministic exploration seed (default: 7)",
    "  --max-actions <n>      Action budget (default: 200)",
    "  --max-minutes <m>      Wall-clock budget in minutes (default: 10)",
    "  --max-findings <n>     Stop after N confirmed findings (default: 4)",
    "",
    "Exit code 1 on adapter-error / initial-observe-failed stops or any",
    "error-level finding outcome; otherwise 0.",
  ].join("\n"),
  run: [
    "Usage: inspector run --adapter fake|web [--json]",
    "",
    "Scripted demonstration scenario against the chosen adapter. Records a",
    "durable run in the workspace store.",
  ].join("\n"),
  runs: [
    "Usage: inspector runs list [--limit n]",
    "       inspector runs show <id>",
    "       inspector runs resume <id>",
    "",
    "  list     Most recent runs (id, status, adapter, created). Empty stores",
    "           print 'no runs recorded'.",
    "  show     Steps and outcomes for one run.",
    "  resume   Re-attach a fresh adapter process to a recorded run, mark",
    "           in-flight actions unknown, and print a re-observed summary.",
    "           Fails honestly when the original adapter kind is not",
    "           recoverable from the stored record.",
  ].join("\n"),
  findings: [
    "Usage: inspector findings list [--run <id>] [--limit n]",
    "       inspector findings show <id>",
    "",
    "  list     Findings (newest first), optionally filtered by run.",
    "  show     One finding with status history, reproduction stats, artifact",
    "           refs count, and the evidence bundle path when it exists on disk.",
  ].join("\n"),
  help: ["Usage: inspector help [command]", "", "Show help for a command."].join("\n"),
};

export function commandHelp(command: string): string {
  return COMMAND_HELP[command] ?? generalUsage();
}
