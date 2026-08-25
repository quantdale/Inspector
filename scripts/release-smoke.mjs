import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.RELEASE_VERSION ?? "0.1.0-m11.0";
const build = spawnSync(process.execPath, [join(root, "scripts", "build-release.mjs")], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, RELEASE_VERSION: version },
  stdio: "pipe",
});
if (build.status !== 0) {
  process.stderr.write(build.stdout ?? "");
  process.stderr.write(build.stderr ?? "");
  process.exit(build.status ?? 1);
}

const outDir = join(root, "dist-release");
const tarball = readdirSync(outDir).find((name) => name.endsWith(".tgz"));
if (!tarball) throw new Error("release smoke: build produced no npm tarball");
const prefix = mkdtempSync(join(tmpdir(), "inspector-release-smoke-"));

function runNpm(args) {
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmArgs = process.platform === "win32"
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args]
    : args;
  const result = spawnSync(npmCommand, npmArgs, {
    cwd: prefix,
    encoding: "utf8",
    env: {
      ...process.env,
      // The smoke proves the CLI distribution without requiring a browser or
      // the optional Electron binary to download on every CI run.
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    },
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed (${result.error?.message ?? "exit " + result.status}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

function runInspector(args, expectedCode = 0) {
  const bin = join(prefix, "node_modules", "inspector-cli", "bundle", "inspector-cli.js");
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: prefix,
    encoding: "utf8",
    env: { ...process.env, INSPECTOR_WORKSPACE: prefix },
    stdio: "pipe",
  });
  if (result.status !== expectedCode) {
    throw new Error(`inspector ${args.join(" ")} returned ${result.status}, expected ${expectedCode}:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

try {
  runNpm(["install", "--no-audit", "--no-fund", join(outDir, tarball)]);
  const installed = join(prefix, "node_modules", "inspector-cli", "build-manifest.json");
  const manifest = JSON.parse(readFileSync(installed, "utf8"));
  if (manifest.schema !== "inspector-release/2" || manifest.version !== version) {
    throw new Error("release smoke: installed provenance manifest is not truthful");
  }
  const versionResult = runInspector(["--version"]);
  if (versionResult.stdout.trim() !== version) throw new Error("release smoke: --version mismatch");
  const doctor = runInspector(["doctor", "--json"]);
  JSON.parse(doctor.stdout);
  const hunt = runInspector(["hunt", "--adapter", "fake", "--max-actions", "8", "--max-minutes", "1", "--json"]);
  const huntPayload = JSON.parse(hunt.stdout);
  if (huntPayload.schema !== "inspector-cli/hunt/1" || huntPayload.command !== "hunt" || typeof huntPayload.runId !== "string") throw new Error("release smoke: fake hunt schema mismatch");
  const explore = runInspector(["explore", "--adapter", "fake", "--max-actions", "8", "--max-minutes", "1", "--json"]);
  const explorePayload = JSON.parse(explore.stdout);
  if (explorePayload.schema !== "inspector-cli/explore/1" || explorePayload.command !== "explore") throw new Error("release smoke: fake explore schema mismatch");
  JSON.parse(runInspector(["findings", "list", "--json"]).stdout);
  JSON.parse(runInspector(["runs", "list", "--json"]).stdout);
  JSON.parse(runInspector(["campaign", "list", "--json"]).stdout);

  // M12 F10: installed-artifact campaign operation.
  const manifestPath = join(prefix, "m12-campaign.yaml");
  writeFileSync(
    manifestPath,
    [
      "schema: inspector-campaign-manifest/1",
      "id: smoke-fleet",
      "workers: 2",
      "items:",
      "  - id: one",
      "    workflow: hunt",
      "    adapterFamily: fake",
      "    seed: 11",
      "    steps: 2",
      "  - id: two",
      "    workflow: explore",
      "    adapterFamily: fake",
      "    seed: 22",
      "    steps: 2",
      "    priority: 2",
    ].join("\n"),
    "utf8",
  );
  const validated = JSON.parse(runInspector(["campaign", "validate", "--manifest", manifestPath, "--json"]).stdout);
  if (validated.schema !== "inspector-cli/campaign-validate/1" || validated.ok !== true || validated.result.items.length !== 2) {
    throw new Error("release smoke: campaign manifest validation mismatch");
  }
  const campaignRun = JSON.parse(runInspector(["campaign", "run", "--manifest", manifestPath, "--json"]).stdout);
  if (campaignRun.campaign.status !== "complete" || [...campaignRun.campaign.completed].sort().join() !== "one,two") {
    throw new Error("release smoke: installed campaign run mismatch");
  }
  if (new Set(campaignRun.campaign.executions.map((e) => e.workerId)).size !== 2) {
    throw new Error("release smoke: installed campaign did not use two workers");
  }
  const shown = JSON.parse(runInspector(["campaign", "show", "smoke-fleet", "--json"]).stdout);
  if (shown.campaign.status !== "complete" || typeof shown.campaign.elapsedMs !== "number") {
    throw new Error("release smoke: installed campaign show mismatch");
  }

  // M13 F26: the intelligence surface ships in the installed artifact.
  // (1) help exposes model configuration; (2) `models summary` operates from
  // the installed prefix; (3) a local deterministic provider module loads and
  // a fake hunt stays deterministic with it configured; (4) malformed
  // provider configuration fails with a stable classification.
  const huntHelp = runInspector(["help", "hunt"]);
  if (!huntHelp.stdout.includes("--model-provider") || !huntHelp.stdout.includes("Budget permission is obtained BEFORE any model call")) {
    throw new Error("release smoke: installed CLI does not document model assistance");
  }
  const modelsSummary = JSON.parse(runInspector(["models", "summary", "--json"]).stdout);
  if (modelsSummary.schema !== "inspector-cli/models/1" || modelsSummary.summary.attempts !== 0) {
    throw new Error("release smoke: models summary mismatch");
  }
  const providerPath = join(prefix, "smoke-provider.mjs");
  writeFileSync(
    providerPath,
    [
      "export function createModelProviders() {",
      "  return [{",
      "    meta: { id: \"smoke-fixture\", roles: [\"planner\"], priority: 10 },",
      "    healthy: () => true,",
      "    invoke: async () => ({ text: JSON.stringify({ actionKey: null, confidence: 0 }) }),",
      "  }];",
      "}",
    ].join("\n") + "\n",
    "utf8",
  );
  const modelHunt = JSON.parse(runInspector([
    "hunt", "--adapter", "fake", "--max-actions", "8", "--max-minutes", "1",
    "--model-provider", providerPath, "--json",
  ]).stdout);
  if (modelHunt.schema !== "inspector-cli/hunt/1" || modelHunt.ok !== true) {
    throw new Error("release smoke: provider-configured fake hunt failed");
  }
  const badProviderPath = join(prefix, "broken-provider.mjs");
  writeFileSync(badProviderPath, "export default { not: 'a provider' };\n", "utf8");
  const refused = runInspector(
    ["hunt", "--adapter", "fake", "--max-actions", "2", "--planner", "--json", "--model-provider", badProviderPath],
    4,
  );
  const refusal = JSON.parse(refused.stdout);
  if (refusal.error?.kind !== "invalid-provider") {
    throw new Error(`release smoke: expected invalid-provider classification, got ${JSON.stringify(refusal.error)}`);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    schema: "inspector-release-smoke/1",
    version,
    tarball,
    workspace: prefix,
    commands: ["--version", "doctor --json", "hunt --adapter fake", "explore --adapter fake", "findings list", "runs list", "campaign list", "campaign validate --manifest", "campaign run --manifest", "campaign show", "models summary", "hunt --model-provider <fixture>", "invalid-provider refusal"],
  }, null, 2) + "\n");
} finally {
  rmSync(prefix, { recursive: true, force: true });
}
