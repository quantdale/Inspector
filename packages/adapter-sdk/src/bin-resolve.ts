import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface AdapterBinRef {
  command: string;
  args: string[];
  binFile: string;
}

export type AdapterBinKind = "bundled" | "compiled" | "source";

export interface AdapterBinPick {
  kind: AdapterBinKind;
  binFile: string;
}

/**
 * Pure layout decision shared by every adapter spawn descriptor:
 * 1. `bundledFileName` sibling of the calling module (release artifact layout),
 * 2. `<devSegments>.js` relative to the calling module (tsc-built tree),
 * 3. `<devSegments>.ts` relative to the calling module (workspace checkout).
 */
export function pickAdapterBinFile(
  fromDir: string,
  bundledFileName: string,
  ...devSegments: string[]
): AdapterBinPick {
  const bundled = join(fromDir, bundledFileName);
  if (existsSync(bundled)) return { kind: "bundled", binFile: bundled };
  const stem = join(fromDir, ...devSegments);
  const compiled = `${stem}.js`;
  if (existsSync(compiled)) return { kind: "compiled", binFile: compiled };
  const source = `${stem}.ts`;
  if (existsSync(source)) return { kind: "source", binFile: source };
  throw new Error(`adapter binary not found: tried ${bundled}, ${compiled}, ${source}`);
}

/**
 * Full spawn reference for an adapter binary. Source-layout picks run through
 * an absolutely resolved tsx loader so subprocess startup never depends on the
 * caller's cwd having tsx on its node_modules chain.
 */
export function resolveAdapterBin(
  fromUrl: string,
  bundledFileName: string,
  ...devSegments: string[]
): AdapterBinRef {
  const fromDir = dirname(fileURLToPath(fromUrl));
  const pick = pickAdapterBinFile(fromDir, bundledFileName, ...devSegments);
  if (pick.kind === "source") {
    const tsxHref = pathToFileURL(createRequire(fromUrl).resolve("tsx")).href;
    return { command: process.execPath, args: ["--import", tsxHref, pick.binFile], binFile: pick.binFile };
  }
  return { command: process.execPath, args: [pick.binFile], binFile: pick.binFile };
}
