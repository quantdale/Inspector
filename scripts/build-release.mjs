import { createHash } from "node:crypto";
import {
  existsSync,
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
  files: ["bundle/", "INSTALL.txt"],
  dependencies: {
    "@lydell/node-pty": "^1.1.0",
    ajv: "^8.17.1",
    "ajv-formats": "^3.0.1",
    "better-sqlite3": "^11.7.0",
    playwright: "^1.49.1",
  },
};

writeFileSync(
  join(outDir, "package.json"),
  `${JSON.stringify(meta, null, 2)}\n`,
);

writeFileSync(
  join(outDir, "INSTALL.txt"),
  [
    `Inspector CLI ${version}`,
    "",
    "Install from this directory:",
    "  npm install -g <this-directory>",
    "",
    "Then enable browser targets (downloads Chromium once):",
    "  npx --yes playwright install chromium",
    "",
    "Verify:",
    "  inspector --version",
    "  inspector doctor",
    "",
    "Notes:",
    "- Native modules (better-sqlite3, @lydell/node-pty) are fetched/compiled during install.",
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
checksumFiles.push("bundle/inspector-version.txt");

const checksumLines = checksumFiles
  .filter((rel) => existsSync(join(outDir, rel)))
  .map((rel) => `${sha256(join(outDir, rel))}  ${rel}`);
writeFileSync(join(outDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);

const platformTag = `${process.platform}-${process.arch}`;
const zipName = `inspector-cli-${version}-${platformTag}.zip`;
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
      "bundle",
      "package.json",
      "INSTALL.txt",
      "SHA256SUMS.txt",
    ],
    { cwd: outDir, stdio: "inherit" },
  );
  if (rc.status !== 0)
    throw new Error(`tar (zip) failed with status ${rc.status}`);
} else {
  const rc = spawnSync(
    "zip",
    ["-r", zipName, "bundle", "package.json", "INSTALL.txt", "SHA256SUMS.txt"],
    { cwd: outDir, stdio: "inherit" },
  );
  if (rc.status !== 0) throw new Error(`zip failed with status ${rc.status}`);
}

console.log(`release artifact: ${relative(root, join(outDir, zipName))}`);
