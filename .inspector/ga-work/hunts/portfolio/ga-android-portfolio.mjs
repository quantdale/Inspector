/**
 * GA P4: Android portfolio lane — com.android.settings on a live headless
 * AVD, driven through the PRODUCTION AndroidAdapterHandler surface
 * (lifecycle create with launchPackage, observe via uiautomator dump, act
 * click/press). Bespoke loop only for candidate selection/novelty/scroll
 * bookkeeping (audit W6: product-level non-web exploration is Part C).
 *
 * Run from repo root:
 *   node .inspector/ga-work/hunts/portfolio/ga-android-portfolio.mjs [maxActions]
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { RealAdbBackend } from "../../../../packages/android/src/real-backend.js";
import { AndroidAdapterHandler } from "../../../../packages/android/src/android-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_ACTIONS = Number(process.argv[2] ?? 50);
const PKG = "com.android.settings";
const AVD = process.env.GA_AVD ?? "Nitro_API_36";
const SDK = join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const EMU = join(SDK, "emulator", "emulator.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const adb = (args, timeoutMs = 30000) =>
  execFileSync(join(SDK, "platform-tools", "adb.exe"), args, { encoding: "utf8", timeout: timeoutMs });

function liveDevices() {
  try {
    return adb(["devices"])
      .split(/\r?\n/)
      .filter((l) => /\tdevice$/.test(l))
      .map((l) => l.split("\t")[0]);
  } catch {
    return [];
  }
}

async function ensureEmulator() {
  // Reuse an ALREADY-LIVE device when present (multi-instance of one AVD is
  // forbidden by the emulator). Only kill what we spawned ourselves.
  const existing = liveDevices();
  if (existing.length > 0) {
    return { serial: existing[0], ownedByUs: false };
  }
  const emu = spawn(EMU, ["-avd", AVD, "-port", "5556", "-no-window", "-no-audio", "-no-boot-anim"], { stdio: "ignore", detached: true });
  emu.unref();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    for (const d of liveDevices().filter((x) => /^emulator-\d+$/.test(x))) {
      try {
        if (adb(["-s", d, "shell", "getprop", "sys.boot_completed"]).trim() === "1") {
          return { serial: d, ownedByUs: true };
        }
      } catch {}
    }
    await sleep(2000);
  }
  return null;
}

const summary = {
  avd: AVD,
  targetPackage: PKG,
  startedAt: new Date().toISOString(),
};

const bootInfo = await ensureEmulator();
if (!bootInfo) {
  summary.verdict = "ENV_BOOT_TIMEOUT";
  writeFileSync(join(here, "ga-android-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(3);
}
const SERIAL = bootInfo.serial;
summary.serial = SERIAL;
summary.bootedAt = new Date().toISOString();
summary.reusedLiveDevice = !bootInfo.ownedByUs;

const backend = new RealAdbBackend();
const artifactsBase = mkdtempSync(join(tmpdir(), "ga-p4-android-art-"));
const handler = new AndroidAdapterHandler(backend, artifactsBase);
await handler.initialize();
await handler.lifecycle({ op: "create", options: { launchPackage: PKG, runId: "ga_android_portfolio", environmentId: "env" } });
await sleep(2500);

const seen = new Set();
const log = [];
let clicks = 0, backs = 0, scrolls = 0, failures = 0, scrollStreak = 0;

/** Elements tappable on the CURRENT screen; reset when the screen hash
 * changes (re-tapping an id on a NEW screen is normal exploration). */
let screenKey = "";
let tappedHere = new Set();

async function foregroundPkg() {
  try {
    const out = await backend.shell(SERIAL, "dumpsys activity activities | grep topResumedActivity");
    return /([\w.]+)\/[\w.$]+/.exec(out)?.[1] ?? "";
  } catch {
    return "";
  }
}

for (let i = 0; i < MAX_ACTIONS; i++) {
  // Guard: if we left Settings (BACK past root), bring it back.
  const fg = await foregroundPkg();
  if (fg && fg !== PKG) {
    try { await backend.shell(SERIAL, `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`); } catch {}
    await sleep(1500);
  }

  let obs;
  try {
    obs = await handler.observe();
  } catch (e) {
    log.push({ step: i, op: "observe", status: "failed", error: String(e).slice(0, 140) });
    failures++;
    break;
  }
  const nodes = (obs.summary.uiTree ?? []).filter((n) => !n.hidden);
  const texts = nodes.map((n) => `${n.name ?? ""}|${n.text ?? ""}`).join("\n");
  const h = sha(texts);
  const novel = !seen.has(h);
  seen.add(h);
  if (h !== screenKey) {
    screenKey = h;
    tappedHere = new Set();
  }

  const tappable = nodes.filter(
    (n) => n.id && !n.disabled &&
      (n.role === "button" || (n.text && n.text.length <= 40)),
  );
  const fresh = tappable.filter((n) => !tappedHere.has(n.id));
  let outcome;
  let picked = "(none)";
  if (fresh.length > 0 || tappable.length > 0) {
    // Prefer never-tapped-this-screen; otherwise re-tap deterministically at
    // pseudo-random (uiautomator dumps of Settings expose many label texts
    // whose row containers carry no resource-id, so revisits are normal).
    const pool = fresh.length > 0 ? fresh : tappable;
    const pick = pool[(i * 7 + Math.floor(h.length / 3)) % pool.length];
    tappedHere.add(pick.id);
    picked = `${pick.role}#${pick.id}:${String(pick.text ?? pick.name ?? "").slice(0, 24)}`;
    outcome = await handler.act({
      action: { id: `a${i}`, runId: "ga_android_portfolio", environmentId: "env", kind: "click", risk: "interact", deadlineMs: 8000, idempotency: "safe-retry", input: { selector: `#${pick.id}` } },
    }).catch((e) => ({ status: "action-failed", error: { message: String(e).slice(0, 120) } }));
    clicks++;
    scrollStreak = 0;
  } else if (scrollStreak < 5) {
    // Nothing fresh to tap: scroll down (harness-level swipe; production
    // non-web scroll vocabulary is the Part C milestone).
    try { await backend.shell(SERIAL, "input swipe 540 1600 540 300 250"); } catch {}
    scrolls++;
    scrollStreak++;
    outcome = { status: "success" };
    picked = "(scroll)";
  } else {
    outcome = await handler.act({
      action: { id: `a${i}`, runId: "ga_android_portfolio", environmentId: "env", kind: "press", risk: "interact", deadlineMs: 8000, idempotency: "safe-retry", input: { value: "4" } },
    }).catch((e) => ({ status: "action-failed", error: { message: String(e).slice(0, 120) } }));
    backs++;
    scrollStreak = 0;
    picked = "(back)";
  }
  if (outcome.status !== "success") failures++;
  log.push({ step: i, screenHash: h, novel, picked, status: outcome.status, error: outcome.error?.message ?? null });
  await sleep(900);
}

await handler.lifecycle({ op: "close" });
if (bootInfo.ownedByUs) {
  try { adb(["-s", SERIAL, "emu", "kill"]); } catch {}
  await sleep(4000);
}

summary.endedAt = new Date().toISOString();
summary.actions = log.length;
summary.clicks = clicks;
summary.backs = backs;
summary.scrolls = scrolls;
summary.distinctScreens = seen.size;
summary.actionFailures = failures;
summary.honestZeroFindingsNote =
  "Settings is a healthy control-class app; zero findings is a valid result.";
summary.timeline = log;
summary.verdict =
  summary.actions >= Math.floor(MAX_ACTIONS * 0.6) &&
  clicks >= Math.floor(MAX_ACTIONS * 0.25) &&
  failures <= Math.ceil(summary.actions * 0.2)
    ? "PASS"
    : "DEGRADED";

writeFileSync(join(here, "ga-android-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, timeline: undefined }, null, 1));
process.exit(summary.verdict === "PASS" ? 0 : 1);
