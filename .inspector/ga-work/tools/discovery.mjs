/**
 * Dynamic environment discovery for GA field harnesses.
 *
 * No machine-specific paths: every location is resolved via (1) explicit env
 * override, then (2) standard discovery, then (3) a clear failure telling the
 * operator what to set. Another developer on an equivalent machine must be
 * able to run these harnesses unmodified.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

function firstLine(cmd, args) {
  try {
    return spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 }).stdout
      ?.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? "";
  } catch {
    return "";
  }
}

/** Installed `inspector` CLI binary (the packed RC1 artifact), not source. */
export function resolveInspectorBin() {
  if (process.env.GA_INSPECTOR_BIN) {
    if (!existsSync(process.env.GA_INSPECTOR_BIN)) {
      throw new Error(`GA_INSPECTOR_BIN set but missing: ${process.env.GA_INSPECTOR_BIN}`);
    }
    return process.env.GA_INSPECTOR_BIN;
  }
  const hit = process.platform === "win32"
    ? firstLine("where", ["inspector"])
    : firstLine("which", ["inspector"]);
  if (!hit) {
    throw new Error(
      "installed `inspector` binary not found on PATH; install the artifact or set GA_INSPECTOR_BIN",
    );
  }
  return hit;
}

/**
 * Root directory of the INSTALLED inspector-cli package (global npm prefix by
 * default). Used to load the artifact's own native deps (better-sqlite3).
 */
export function resolveArtifactNodeModules() {
  const override = process.env.GA_ARTIFACT_NODE_MODULES;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`GA_ARTIFACT_NODE_MODULES set but missing: ${override}`);
    }
    return override;
  }
  let globalRoot = "";
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    globalRoot = execFileSync(npmBin, ["root", "-g"], { encoding: "utf8" }).trim();
  } catch {
    /* fall through to PATH-relative guess */
  }
  const candidates = [];
  if (globalRoot) candidates.push(join(globalRoot, "inspector-cli"));
  // Windows global layout: <prefix>/node_modules/inspector-cli next to the shim.
  const bin = (() => {
    try { return resolveInspectorBin(); } catch { return ""; }
  })();
  if (bin) {
    candidates.push(join(dirname(bin), "node_modules", "inspector-cli"));
  }
  for (const c of candidates) {
    if (existsSync(join(c, "package.json"))) return join(c, "node_modules");
  }
  throw new Error(
    `installed inspector-cli package not found (tried: ${candidates.join(", ") || "none"}); set GA_ARTIFACT_NODE_MODULES`,
  );
}

/** better-sqlite3 from the installed artifact; explicit error otherwise. */
export function resolveBetterSqlite3() {
  const bases = [resolveArtifactNodeModules(), process.cwd()];
  const req = createRequire(import.meta.url);
  for (const base of bases) {
    try {
      return req(req.resolve("better-sqlite3", { paths: [base] }));
    } catch {
      /* try next root */
    }
  }
  throw new Error(`better-sqlite3 not resolvable from: ${bases.join(", ")}`);
}

/**
 * JS entry file of the INSTALLED artifact (package.json bin), so harnesses
 * can spawn `node <entry>` directly — no shell/quoting ambiguity — while
 * still executing exactly the installed artifact's code.
 */
export function resolveArtifactEntry() {
  const pkgDir = dirname(normalize(resolveArtifactNodeModules()));
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const bin = typeof pkg.bin === "string"
    ? pkg.bin
    : pkg.bin?.inspector ?? Object.values(pkg.bin ?? {})[0];
  if (!bin) throw new Error(`installed package at ${pkgDir} declares no bin`);
  const entry = join(pkgDir, bin);
  if (!existsSync(entry)) throw new Error(`artifact entry missing: ${entry}`);
  if (process.env.GA_EXPECTED_ARTIFACT_VERSION && pkg.version !== process.env.GA_EXPECTED_ARTIFACT_VERSION) {
    throw new Error(
      `artifact version mismatch: expected ${process.env.GA_EXPECTED_ARTIFACT_VERSION}, found ${pkg.version} (${pkgDir})`,
    );
  }
  return entry;
}

/** vim executable for PTY soaks: env override → PATH → Git-for-Windows layout. */
export function resolveVimExe() {
  if (process.env.GA_VIM_EXE) {
    if (!existsSync(process.env.GA_VIM_EXE)) {
      throw new Error(`GA_VIM_EXE set but missing: ${process.env.GA_VIM_EXE}`);
    }
    return process.env.GA_VIM_EXE;
  }
  const onPath = process.platform === "win32"
    ? firstLine("where", ["vim.exe"])
    : firstLine("which", ["vim"]);
  if (onPath && existsSync(onPath)) return onPath;
  const gitExec = firstLine("git", ["--exec-path"]);
  if (gitExec) {
    const candidate = join(gitExec, "..", "..", "..", "usr", "bin", "vim.exe");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("vim executable not found (PATH / Git-for-Windows); set GA_VIM_EXE");
}

const tasklistCsv = (filter) => {
  const out = spawnSync("tasklist", ["/FI", filter, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    timeout: 15000,
  });
  return out.status === 0 ? (out.stdout ?? "") : "";
};

/** PIDs of all processes with the given image name ([] when none/error). */
export function imagePids(imageName) {
  const rows = tasklistCsv(`/IMAGENAME eq ${imageName}`);
  const pids = [];
  for (const line of rows.split(/\r?\n/)) {
    const m = line.match(/^"[^"]+","(\d+)"/);
    if (m) pids.push(Number(m[1]));
  }
  return pids;
}

export function pidAlive(pid) {
  return tasklistCsv(`/PID eq ${pid}`).includes(`","${pid}"`);
}
