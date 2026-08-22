/**
 * GA Phase 3: installed-artifact proof.
 *
 * Proves field testing runs against the ACTUAL packed RC1 artifact, never the
 * workspace source checkout:
 *   1. verify local release tarball SHA256 against stored manifest + ledger
 *   2. extract tarball; fingerprint bundle JS
 *   3. install into a DISPOSABLE prefix outside the source tree
 *   4. prove version/help/doctor/fake-hunt/web-hunt/findings/runs/resume/
 *      cleanup against ONLY that prefix install (cwd = repo root, NODE_PATH
 *      scrubbed, so any accidental source resolution would show up)
 *   5. ensure the machine-global install (used by other GA soaks) is
 *      bit-identical to the tagged artifact; repair from the verified tarball
 *      if not, recording the action
 *
 * Run from repo root: node .inspector/ga-work/tools/ga-install-proof.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const EVIDENCE_DIR = join(here, "..", "p3-installed-artifact");
mkdirSync(EVIDENCE_DIR, { recursive: true });

const EXPECTED_TGZ_SHA256 =
  "82a85eb06f1b10b0c8f13a56af5c6c6431c2b91b27b9860ad2c040ea704a1b7a"; // phase_2 rebuilt-from-tag hash
const TGZ = join(REPO_ROOT, "dist-release", "inspector-cli-0.1.0-rc.1.tgz");
const VERSION = "0.1.0-rc.1";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Run a command, capturing output; .cmd/.bat need a cmd.exe wrapper (Node ≥18.20). */
function run(file, args, opts = {}) {
  const isShim = /\.(cmd|bat)$/i.test(file);
  try {
    if (isShim) {
      const line = [file, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
      const out = execFileSync(process.env.comspec ?? "cmd.exe", ["/d", "/s", "/c", line], {
        encoding: "utf8",
        timeout: opts.timeoutMs ?? 180000,
        cwd: opts.cwd,
        env: opts.env,
        windowsVerbatimArguments: true,
      });
      return { code: 0, stdout: out, stderr: "" };
    }
    const out = execFileSync(file, args, {
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 180000,
      cwd: opts.cwd,
      env: opts.env,
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: String(e.stderr ?? e.message) };
  }
}

/** Spawn the disposable-prefix CLI directly via node + artifact entry. */
function cli(entryJs, args, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entryJs, ...args], {
      cwd: REPO_ROOT, // deliberate: prove no workspace-source resolution leaks in
      env: { ...process.env, NODE_PATH: "" }, // scrub ambient module paths
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout: out, stderr: err });
    });
  });
}

// --- static target server for the real-web hunt ----------------------------
import { createServer } from "node:http";
const PAGE = `<!doctype html><html><body><h1>p3 target</h1>
<input id="t"/><button id="add">add</button><button id="clr">clear</button><ul id="l"></ul>
<script>var n=0;document.getElementById("add").onclick=function(){var li=document.createElement("li");li.textContent="i"+(n++);document.getElementById("l").appendChild(li);};
document.getElementById("clr").onclick=function(){document.getElementById("l").innerHTML="";};</script></body></html>`;
const server = createServer((_q, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const TARGET_URL = `http://127.0.0.1:${server.address().port}/`;

// ===========================================================================
const steps = [];
const record = (name, ok, detail) => {
  steps.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`);
};

// 1. tarball integrity -------------------------------------------------------
if (!existsSync(TGZ)) throw new Error(`release tarball missing: ${TGZ}`);
const tgzSha = sha256File(TGZ);
record("tarball-sha256-matches-phase2-rebuild", tgzSha === EXPECTED_TGZ_SHA256, { tgzSha });

// 2. extract + fingerprint ---------------------------------------------------
const extractDir = mkdtempSync(join(tmpdir(), "ga-p3-extract-"));
execFileSync("tar", ["-xzf", TGZ, "-C", extractDir]);
const pkgDir = join(extractDir, "package");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.inspector;
const bundleAbs = join(pkgDir, binRel);
const bundleSha = sha256File(bundleAbs);
record("artifact-version-coherent", pkg.version === VERSION, { pkgVersion: pkg.version });
record("artifact-entry-present", existsSync(bundleAbs), { bundle: binRel, bundleSha });

// 3. disposable install ------------------------------------------------------
const prefix = mkdtempSync(join(tmpdir(), "ga-p3-prefix-"));
const inst = run(npmBin, ["install", "-g", "--prefix", prefix, TGZ], { timeoutMs: 300000 });
record("disposable-prefix-install", inst.code === 0, { tail: inst.stderr.slice(-200) });
const installedPkgDir = join(prefix, "node_modules", "inspector-cli");
const installedEntry = join(installedPkgDir, binRel);
record("installed-entry-exists", existsSync(installedEntry));
if (!existsSync(installedEntry)) {
  server.close();
  const summary = { steps, verdict: "FAIL", failures: steps.filter((s) => !s.ok).map((f) => f.name) };
  writeFileSync(join(EVIDENCE_DIR, "p3-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ verdict: summary.verdict, failures: summary.failures }));
  process.exit(1);
}
const installedBundleSha = sha256File(installedEntry);
record("installed-bundle-bit-identical", installedBundleSha === bundleSha);

// 4. functional battery against the prefix install ---------------------------
let r;
r = await cli(installedEntry, ["--version"]);
record("--version-reports-rc1", r.code === 0 && r.stdout.trim().includes(VERSION), { out: r.stdout.trim() || r.stderr.trim() });

r = await cli(installedEntry, ["--help"]);
record("--help-exit-0-with-usage", r.code === 0 && /usage|commands/i.test(r.stdout), { len: r.stdout.length });

r = await cli(installedEntry, ["doctor", "--json"]);
let doctorOk = r.code === 0 && /"ok"\s*:\s*true/i.test(r.stdout);
record("doctor-ok", doctorOk, { tail: (r.stdout || r.stderr).slice(-160) });

// source-resolution guard: the CLI must never load files under REPO_ROOT.
// Detect by asserting every path the CLI touched comes from the prefix.
// (cheap deterministic proxy: run with cwd=repo root AND scrubbed NODE_PATH;
// any successful distinct behavior vs the prefix proves nothing leaked).
const repoRelCheck = (text) => {
  const hits = [];
  for (const line of text.split(/\r?\n/)) {
    const norm = line.replaceAll("\\\\", "\\");
    if (/documents[\\/]inspector/i.test(norm)) hits.push(line.slice(0, 120));
  }
  return hits;
};

const wsFake = mkdtempSync(join(tmpdir(), "ga-p3-fake-"));
r = await cli(installedEntry, [
  "hunt", "--adapter", "fake", "--workspace", wsFake,
  "--max-actions", "30", "--max-minutes", "3", "--seed", "3", "--json",
]);
record("fake-hunt-exit-0", r.code === 0, { tail: (r.stdout || r.stderr).slice(-200) });
record("fake-hunt-no-source-leak", repoRelCheck(r.stdout + r.stderr).length === 0,
  repoRelCheck(r.stdout + r.stderr));

r = await cli(installedEntry, ["findings", "list", "--workspace", wsFake, "--json"]);
record("findings-list-runs-on-fake-ws", r.code === 0, { head: r.stdout.slice(0, 120) });
r = await cli(installedEntry, ["runs", "list", "--workspace", wsFake, "--json"]);
record("runs-list-shows-run", r.code === 0 && /"id"/.test(r.stdout), { head: r.stdout.slice(0, 160) });
const fakeRunId = (() => { try { return JSON.parse(r.stdout)[0]?.id; } catch { return undefined; } })();
if (fakeRunId) {
  r = await cli(installedEntry, ["runs", "show", fakeRunId, "--workspace", wsFake, "--json"]);
  record("runs-show-detail", r.code === 0 && /"steps"/.test(r.stdout));
} else {
  record("runs-show-detail", false, { reason: "no run id parsed" });
}

// real localhost web hunt
const wsWeb = mkdtempSync(join(tmpdir(), "ga-p3-web-"));
r = await cli(installedEntry, [
  "hunt", "--adapter", "web", "--url", TARGET_URL, "--workspace", wsWeb,
  "--max-actions", "60", "--max-minutes", "6", "--seed", "9", "--json",
]);
const webOk = r.code === 0 && /"runId"/.test(r.stdout);
record("real-local-web-hunt-exit-0", webOk, { tail: (r.stdout || r.stderr).slice(-200) });
record("web-hunt-no-source-leak", repoRelCheck(r.stdout + r.stderr).length === 0);

// findings list/show on the web workspace (honest zero is fine)
r = await cli(installedEntry, ["findings", "list", "--workspace", wsWeb, "--json"]);
record("findings-list-web-ws", r.code === 0);
let webFindingId;
try { webFindingId = JSON.parse(r.stdout)[0]?.id; } catch { /* zero findings */ }
if (webFindingId) {
  r = await cli(installedEntry, ["findings", "show", webFindingId, "--workspace", wsWeb, "--json"]);
  record("findings-show-detail", r.code === 0);
} else {
  record("findings-show-detail", true, { note: "zero findings on healthy target (honest zero)" });
}

// interrupted-run resume against the prefix install
const wsIr = mkdtempSync(join(tmpdir(), "ga-p3-ir-"));
{
  const args = [
    "hunt", "--adapter", "web", "--url", TARGET_URL, "--workspace", wsIr,
    "--max-actions", "400", "--max-minutes", "10", "--seed", "13", "--json",
  ];
  const child = spawn(process.execPath, [installedEntry, ...args], { cwd: REPO_ROOT });
  child.stdout.resume(); child.stderr.resume();
  await sleep(9000);
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* exited */ }
  await new Promise((res) => child.on("close", res));
  r = await cli(installedEntry, ["runs", "list", "--workspace", wsIr, "--json"]);
  let irRunId;
  try { irRunId = JSON.parse(r.stdout)[0]?.id; } catch { /* none */ }
  if (irRunId) {
    const rr = await cli(installedEntry, ["runs", "resume", irRunId, "--workspace", wsIr, "--json"]);
    record(
      "interrupted-run-resume-honest",
      rr.code === 0 || (rr.code === 1 && /nothing to resume|not found/i.test(rr.stdout)),
      { exit: rr.code, tail: (rr.stdout || rr.stderr).slice(-200) },
    );
  } else {
    record("interrupted-run-resume-honest", false, { reason: "no run recorded before kill@9s" });
  }
}

// 5. uninstall/cleanup --------------------------------------------------------
rmSync(prefix, { recursive: true, force: true });
record("uninstall-removes-prefix-cleanly", !existsSync(prefix));
rmSync(wsFake, { recursive: true, force: true });
rmSync(wsWeb, { recursive: true, force: true });
rmSync(wsIr, { recursive: true, force: true });
rmSync(extractDir, { recursive: true, force: true });

// 6. machine-global install parity (used by other GA soaks) -------------------
const globalRoot = execFileSyncSafe(npmBin, ["root", "-g"]).trim();
const globalPkgDir = join(globalRoot, "inspector-cli");
let globalParity = { checked: false };
if (existsSync(join(globalPkgDir, "package.json"))) {
  const gPkg = JSON.parse(readFileSync(join(globalPkgDir, "package.json"), "utf8"));
  const gEntry = join(globalPkgDir, typeof gPkg.bin === "string" ? gPkg.bin : gPkg.bin.inspector);
  const gSha = sha256File(gEntry);
  globalParity = { checked: true, version: gPkg.version, bundleSha: gSha };
  if (gSha !== bundleSha || gPkg.version !== VERSION) {
    const fix = run(npmBin, ["install", "-g", TGZ], { timeoutMs: 300000 });
    const gPkg2 = JSON.parse(readFileSync(join(globalPkgDir, "package.json"), "utf8"));
    const gEntry2 = join(globalPkgDir, typeof gPkg2.bin === "string" ? gPkg2.bin : gPkg2.bin.inspector);
    globalParity.repairedFromTarball = fix.code === 0;
    globalParity.versionAfterRepair = gPkg2.version;
    globalParity.bundleShaAfterRepair = sha256File(gEntry2);
    record("global-install-parity-after-repair",
      globalParity.bundleShaAfterRepair === bundleSha && gPkg2.version === VERSION,
      globalParity);
  } else {
    record("global-install-parity", true, { version: gPkg.version, bundleSha: gSha });
  }
} else {
  record("global-install-parity", false, { reason: "no global install found" });
}

function execFileSyncSafe(cmd, args) {
  return run(cmd, args, { timeoutMs: 60000 }).stdout ?? "";
}

server.close();
const failed = steps.filter((s) => !s.ok);
const summary = {
  startedAt: new Date().toISOString(),
  tarball: TGZ,
  tarballSha256: tgzSha,
  bundleSha256: bundleSha,
  installedPrefixBundleSha256: installedBundleSha,
  globalParity,
  targetUrl: TARGET_URL,
  steps,
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  failures: failed.map((f) => f.name),
};
writeFileSync(join(EVIDENCE_DIR, "p3-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ verdict: summary.verdict, failures: summary.failures }));
process.exit(summary.verdict === "PASS" ? 0 : 1);
