// M15 release provenance: version coherence guard — root package.json version,
// dist-release/package.json, bundle/inspector-version.txt, and build-manifest.json
// must be coherent; tarball assertions enforce no .inspector/no secrets/no
// absolute path leakage. See packages/repo-contract/src/release-provenance.test.ts.
import { createHash } from "node:crypto";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-release");
const bundleDir = join(outDir, "bundle");

const EXTERNALS = [
  "better-sqlite3",
  "playwright",
  "@lydell/node-pty",
  "ajv",
  "ajv-formats",
  "yaml",
];

const CLI_ENTRY = { in: "packages/cli/src/bin.ts", out: "inspector-cli" };

const ADAPTER_ENTRIES = [
  { in: "packages/adapter-web/src/bin.ts", out: "inspector-adapter-web" },
  { in: "packages/adapter-fake/src/bin.ts", out: "inspector-adapter-fake" },
  { in: "packages/cli-adapter/src/bin.ts", out: "inspector-adapter-cli" },
  {
    in: "packages/windows-adapter/src/bin.ts",
    out: "inspector-adapter-windows",
  },
  { in: "packages/android/src/bin.ts", out: "inspector-adapter-android" },
  {
    in: "packages/electron-adapter/src/bin.ts",
    out: "inspector-adapter-electron",
  },
];

const version = process.env.RELEASE_VERSION ?? "0.1.0-rc.1";

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? String(result.stdout).trim() : "";
}

const sourceCommit = gitOutput(["rev-parse", "HEAD"]);
const sourceStatus = gitOutput(["status", "--porcelain"]);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

const baseOptions = {
  absWorkingDir: root,
  outdir: "dist-release/bundle",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  sourcesContent: false,
  tsconfig: "tsconfig.json",
  external: EXTERNALS,
  logLevel: "info",
};

await esbuild.build({
  ...baseOptions,
  entryPoints: [CLI_ENTRY],
  banner: { js: "#!/usr/bin/env node\n" },
});

await esbuild.build({
  ...baseOptions,
  entryPoints: ADAPTER_ENTRIES,
});

const allEntries = [CLI_ENTRY, ...ADAPTER_ENTRIES];
for (const entry of allEntries) {
  const file = join(bundleDir, `${entry.out}.js`);
  if (!existsSync(file)) {
    throw new Error(`release build missing expected bundle: ${file}`);
  }
}

const fixtureSources = [
  "packages/electron-adapter/src/fixtures/main.cjs",
  "packages/electron-adapter/src/fixtures/renderer.html",
];
const fixturePayload = fixtureSources.map((source) => {
  const name = source.split("/").at(-1);
  const destination = join(bundleDir, "fixtures", name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, source), destination);
  return `bundle/fixtures/${name}`;
});

writeFileSync(join(bundleDir, "inspector-version.txt"), `${version}\n`);

const meta = {
  name: "inspector-cli",
  version,
  description:
    "Inspector: autonomous, durable, typed environment inspection and defect discovery (CLI distribution).",
  // License TRUTH (Phase 9): the repository grants NO license (see README
  // 'License': no open-source license selected, all rights reserved). The
  // artifact must never claim MIT or any other grant. UNLICENSED is npm's
  // factual designation for a package that does not grant usage rights.
  license: "UNLICENSED",
  private: true,
  type: "module",
  engines: { node: ">=22" },
  bin: { inspector: "bundle/inspector-cli.js" },
  files: ["bundle/", "INSTALL.txt", "build-manifest.json", "SHA256SUMS.txt"],
  dependencies: {
    "@lydell/node-pty": "^1.1.0",
    ajv: "^8.17.1",
    "ajv-formats": "^3.0.1",
    "better-sqlite3": "^11.7.0",
    playwright: "^1.62.1",
    yaml: "^2.9.0",
  },
  optionalDependencies: {
    // Electron is optional because its native executable is large and some
    // operators only need web/native adapters. The adapter reports and refuses
    // honestly when the optional executable is not available.
    electron: "43.4.1",
  },
};

writeFileSync(
  join(outDir, "package.json"),
  `${JSON.stringify(meta, null, 2)}\n`,
);

const buildManifest = {
  schema: "inspector-release/2",
  product: "inspector-cli",
  version,
  source: {
    commit: sourceCommit || null,
    dirty: sourceStatus.length > 0,
  },
  build: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    builtAt: new Date().toISOString(),
  },
  package: {
    name: meta.name,
    license: meta.license,
    engines: meta.engines,
    dependencies: meta.dependencies,
    optionalDependencies: meta.optionalDependencies,
  },
  entries: allEntries.map((entry) => entry.out),
  payload: [
    "package.json",
    "INSTALL.txt",
    "build-manifest.json",
    "SHA256SUMS.txt",
    ...allEntries.flatMap((entry) => [`bundle/${entry.out}.js`, `bundle/${entry.out}.js.map`]),
    "bundle/inspector-version.txt",
    ...fixturePayload,
  ],
};
writeFileSync(
  join(outDir, "build-manifest.json"),
  `${JSON.stringify(buildManifest, null, 2)}\n`,
);

writeFileSync(
  join(outDir, "INSTALL.txt"),
  [
    `Inspector CLI ${version}`,
    "",
    "Install globally from the packed tarball (dependencies are pulled",
    "automatically):",
    "  npm pack <this-directory>",
    "  npm install -g inspector-cli-<version>.tgz",
    "",
    "NOTE: `npm install -g <this-directory>` (folder form) does NOT install",
    "production dependencies on current npm - use the tarball flow.",
    "",
    "Then enable browser targets (downloads Chromium once):",
    "  npx --yes playwright install chromium",
    "",
    "Verify:",
    "  inspector --version",
    "  inspector doctor",
    "  inspector campaign list --json",
    "",
    "Notes:",
    "- Native modules (better-sqlite3, @lydell/node-pty) are fetched/compiled during install.",
    "- Electron is optional; install may omit its executable. `doctor` reports",
    "  that condition and the adapter never presents injectable coverage as real.",
    "- State lives under your workspace (.inspector/); set INSPECTOR_WORKSPACE to isolate runs.",
  ].join("\r\n"),
);

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const checksumFiles = ["package.json", "INSTALL.txt"];
for (const entry of allEntries) {
  checksumFiles.push(`bundle/${entry.out}.js`, `bundle/${entry.out}.js.map`);
}
checksumFiles.push("bundle/inspector-version.txt", "build-manifest.json", ...fixturePayload);

const checksumLines = checksumFiles
  .filter((rel) => existsSync(join(outDir, rel)))
  .map((rel) => `${sha256(join(outDir, rel))}  ${rel}`);
writeFileSync(join(outDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);

const platformTag = `${process.platform}-${process.arch}`;
const zipName = `inspector-cli-${version}-${platformTag}.zip`;
const archiveFiles = ["bundle", "package.json", "INSTALL.txt", "build-manifest.json", "SHA256SUMS.txt"];
if (process.platform === "win32") {
  // Windows ships bsdtar (C:\Windows\System32\tar.exe); `tar -a -cf x.zip`
  // writes a spec-compliant zip with forward-slash entries that any unzip
  // tool reads. Compress-Archive's backslash entries break Info-ZIP.
  const rc = spawnSync(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
    [
      "-a",
      "-c",
      "-f",
      zipName,
      ...archiveFiles,
    ],
    { cwd: outDir, stdio: "inherit" },
  );
  if (rc.status !== 0)
    throw new Error(`tar (zip) failed with status ${rc.status}`);
} else {
  const rc = spawnSync(
    "zip",
    ["-r", zipName, ...archiveFiles],
    { cwd: outDir, stdio: "inherit" },
  );
  if (rc.status !== 0) throw new Error(`zip failed with status ${rc.status}`);
}

// Also emit the npm tarball: it is the ONLY global-install form that pulls
// production dependencies reliably across npm versions (folder-form
// `npm install -g <dir>` skips them). Recorded in the release manifest.
const packed = spawnSync("npm", ["pack", "--pack-destination", "."], {
  cwd: outDir,
  stdio: "pipe",
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (packed.status !== 0)
  throw new Error(
    `npm pack failed with status ${packed.status}: ${packed.stderr}`,
  );
const tgzName = String(packed.stdout).trim().split("\n").at(-1).trim();
if (!existsSync(join(outDir, tgzName)))
  throw new Error(`npm pack produced no tarball: ${tgzName}`);

function assertPackedContents(tgzPath) {
  const listed = spawnSync("tar", ["-tf", tgzPath], {
    cwd: outDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (listed.status !== 0) {
    throw new Error(`cannot inspect packed tarball: ${listed.stderr}`);
  }
  const entries = String(listed.stdout)
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\/$/, ""))
    .filter(Boolean);
  const forbidden = /(?:^|\/)(?:node_modules|\.git|\.inspector|test|tests|fixtures|evidence|artifacts|\.env(?:$|\.))/i;
  for (const entry of entries) {
    if (!entry.startsWith("package/")) throw new Error(`tarball entry escapes package root: ${entry}`);
    const rel = entry.slice("package/".length);
    if (!rel || rel === "bundle") continue;
    if (forbidden.test(rel) && !rel.startsWith("bundle/fixtures/")) throw new Error(`forbidden development/evidence content in tarball: ${entry}`);
    if (!(rel === "package.json" || rel === "INSTALL.txt" || rel === "build-manifest.json" || rel === "SHA256SUMS.txt" || rel.startsWith("bundle/"))) {
      throw new Error(`unexpected tarball content: ${entry}`);
    }
  }
}

assertPackedContents(join(outDir, tgzName));

const zipSha = `${sha256(join(outDir, zipName))}  ${zipName}\n`;
const tgzSha = `${sha256(join(outDir, tgzName))}  ${tgzName}\n`;
writeFileSync(join(outDir, `${zipName}.sha256`), zipSha);
writeFileSync(join(outDir, `${tgzName}.sha256`), tgzSha);

console.log(`release artifact: ${relative(root, join(outDir, zipName))}`);
console.log(
  `release tarball:  ${relative(root, join(outDir, tgzName))} ` +
    `(sha256 ${sha256(join(outDir, tgzName))}; source ${sourceCommit || "unknown"})`,
);
