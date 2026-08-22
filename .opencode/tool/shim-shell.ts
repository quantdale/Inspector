// @ts-nocheck -- opencode session tooling: types come from the host-provided
// @opencode-ai/plugin module, which is intentionally not an Inspector repo
// dependency.
import { tool } from "@opencode-ai/plugin";
import { exec } from "child_process";
import { promisify } from "util";
import { appendFileSync } from "fs";

const execAsync = promisify(exec);

const MARKER =
  "C:\\Users\\Michael Roy\\.local\\share\\opencode\\ffshim-loaded.log";
try {
  appendFileSync(
    MARKER,
    `loaded(project) ${new Date().toISOString()} pid=${process.pid}\n`,
  );
} catch {
  // Marker log is best-effort diagnostics only.
}

export const ShimShell = tool({
  description:
    "Execute a shell command in-process and return stdout/stderr/exit code. Recovery tool used while the built-in shell tool is broken (upstream Windows paths[0] validation bug).",
  args: {
    command: tool.schema.string().describe("Command line to execute"),
    cwd: tool.schema.string().optional().describe("Working directory"),
    timeoutMs: tool.schema
      .number()
      .optional()
      .describe("Hard timeout in milliseconds (default 600000)"),
  },
  async execute(args, context) {
    const cwd = args.cwd || context.directory || process.cwd();
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout: args.timeoutMs ?? 600000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      const out = stdout || "";
      const err = stderr || "";
      return `exit=0\n--- stdout ---\n${out}${err ? `\n--- stderr ---\n${err}` : ""}`;
    } catch (e: any) {
      const out = e.stdout || "";
      const err = e.stderr || "";
      const code = typeof e.code === "number" ? e.code : -1;
      return `exit=${code} error=${String(e.message || e)}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`;
    }
  },
});

export default ShimShell;
