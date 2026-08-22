/**
 * GA P4: Android portfolio lane — com.android.settings on a freshly booted
 * headless AVD, driven through the PRODUCTION AndroidAdapterHandler surface
 * (lifecycle create with launchPackage, observe via uiautomator dump, act
 * click/press). Bespoke loop only for candidate selection/novelty bookkeeping
 * (audit W6: product-level non-web exploration is the Part C milestone).
 *
 * Run from repo root:
 *   node .inspector/ga-work/hunts/portfolio/ga-android-portfolio.mjs [maxActions]
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { RealAdbBackend } from "../../../../packages/android/src/real-backend.js";
import { AndroidAdapterHandler } from "../../../../packages/android/src/android-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_ACTIONS = Number(process.argv[2] ?? 50);
const SERIAL = "emulator-5556";
const PKG = "com.android.settings";
const AVD = process.env.GA_AVD ?? "Nitro_API_36";
const SDK = join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const EMU = join(SDK, "emulator", "emulator.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const adb = (args, timeoutMs = 30000) =>
  execFileSync(join(SDK, "platform-tools", "adb.exe"), args, { encoding: "utf8", timeout: timeoutMs });

function bootEmulator() {
  const emu = spawn(EMU, ["-avd", AVD, "-port", "5556", "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot"], { stdio: "ignore", detached: true });
  emu.unref();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    try {
      const devs = adb(["devices"]);
      if (devs.includes(SERIAL)) {
        const boot = adb(["-s", SERIAL, "shell", "getprop", "sys.boot_completed"]).trim();
        if (boot === "1") return true;
      }
    } catch { /* not yet */ }
    sleep(2000);
  }
  return false;
}

async function killEmulator() {
  try { adb(["-s", SERIAL, "emu", "kill"]); } catch {}
  await sleep(4000);
  // Belt and braces: no qemu for this AVD may outlive the run.
  try {
    spawnSync("taskkill", ["/IM", "qemu-system-x86_64.exe", "/F"], { timeout: 15000 });
  } catch {}
}

const summary = {
  avd: AVD,
  serial: SERIAL,
  targetPackage: PKG,
  startedAt: new Date().toISOString(),
};

if (!bootEmulator()) {
  summary.verdict = "ENV_BOOT_TIMEOUT";
  writeFileSync(join(here, "ga-android-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(3);
}
summary.bootedAt = new Date().toISOString();

const backend = new RealAdbBackend();
const artifactsBase = mkdtempSync(join(tmpdir(), "ga-p4-android-art-"));
const handler = new AndroidAdapterHandler(backend, artifactsBase);
await handler.initialize();
await handler.lifecycle({ op: "create", options: { launchPackage: PKG, runId: "ga_android_portfolio", environmentId: "env" } });
await sleep(2500);

const seen = new Set();
const tapped = new Set();
const log = [];
let clicks = 0, backs = 0, failures = 0;

for (let i = 0; i < MAX_ACTIONS; i++) {
  let obs;
  try {
    obs = await handler.observe();
  } catch (e) {
    log.push({ step: i, op: "observe", status: "failed", error: String(e).slice(0, 140) });
    failures++;
    break;
  }
  const nodes = obs.summary.uiTree ?? [];
  const texts = nodes.map((n) => `${n.name ?? ""}|${n.text ?? ""}`).join("\n");
  const h = sha(texts);
  const novel = !seen.has(h);
  seen.add(h);

  // Candidate: unseen tappable element with an id; prefer buttons.
  const cands = nodes.filter(
    (n) => n.id && !n.disabled && !tapped.has(n.id) &&
      /button|switch|checkbox/i.test(`${n.role} ${n.tag}`) === true ||
      (n.id && !n.disabled && !tapped.has(n.id) && n.text),
  );
  const pick = cands.find((n) => !seen.has(`el:${n.id}`)) ?? cands[0];

  let outcome;
  if (!pick && i > 5) {
    // Saturated this screen: BACK to move.
    outcome = await handler.act({
      action: { id: `a${i}`, runId: "ga_android_portfolio", environmentId: "env", kind: "press", risk: "interact", deadlineMs: 8000, idempotency: "safe-retry", input: { value: "4" } },
    }).catch((e) => ({ status: "action-failed", error: { message: String(e).slice(0, 120) } }));
    backs++;
  } else if (!pick) {
    continue; // boot screen churn; observe again
  } else {
    tapped.add(pick.id);
    outcome = await handler.act({
      action: { id: `a${i}`, runId: "ga_android_portfolio", environmentId: "env", kind: "click", risk: "interact", deadlineMs: 8000, idempotency: "safe-retry", input: { selector: `#${pick.id}` } },
    }).catch((e) => ({ status: "action-failed", error: { message: String(e).slice(0, 120) } }));
    clicks++;
    if (outcome.status !== "success") failures++;
  }
  log.push({ step: i, screenHash: h, novel, picked: pick ? `${pick.role}#${pick.id}` : "(back)", status: outcome.status, error: outcome.error?.message ?? null });
  await sleep(900);
}

await handler.lifecycle({ op: "close" });
await killEmulator();

summary.endedAt = new Date().toISOString();
summary.actions = log.length;
summary.clicks = clicks;
summary.backs = backs;
summary.distinctScreens = seen.size;
summary.actionFailures = failures;
summary.honestZeroFindingsNote =
  "Settings is a healthy control-class app; zero findings is a valid result.";
summary.timeline = log;
summary.verdict =
  summary.actions >= Math.floor(MAX_ACTIONS * 0.6) && failures <= Math.ceil(summary.actions * 0.2)
    ? "PASS"
    : "DEGRADED";

writeFileSync(join(here, "ga-android-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, timeline: undefined }, null, 1));
process.exit(summary.verdict === "PASS" ? 0 : 1);
