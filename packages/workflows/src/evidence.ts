import type { EvidenceBundle, OracleSignal } from "@inspector/finding";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./atomic.js";
import type { ProgressFn } from "./types.js";

/** Write evidence bundles to <base>/bundles/<runId>/<findingId>.json. */
export function writeEvidenceBundles(
  base: string,
  runId: string,
  bundles: EvidenceBundle[],
): Map<string, string> {
  const dir = join(base, "bundles", runId);
  mkdirSync(dir, { recursive: true });
  const paths = new Map<string, string>();
  for (const bundle of bundles) {
    const path = join(dir, `${bundle.finding.id}.json`);
    writeJsonAtomic(path, bundle);
    paths.set(bundle.finding.id, path);
  }
  return paths;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Await run.close(), giving up (honestly) after 15s instead of hanging. */
export async function closeRunGuarded(run: import("@inspector/core").RunController, warn: ProgressFn): Promise<void> {
  const CLOSE_BUDGET_MS = 15000;
  let finished = false;
  await Promise.race([
    run.close().then(() => {
      finished = true;
    }),
    sleep(CLOSE_BUDGET_MS),
  ]);
  if (!finished) {
    warn(
      `teardown: run.close() exceeded ${CLOSE_BUDGET_MS / 1000}s; continuing teardown ` +
        "(the adapter subprocess may need manual cleanup)",
    );
  }
}

/** Merge replay evidence with the ingest signal, deduplicating exact repeats. */
export function mergeSignals(primary: OracleSignal[], extra: OracleSignal[]): OracleSignal[] {
  const key = (s: OracleSignal) =>
    `${s.kind}|${typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail) ?? ""}`;
  const out = primary.slice();
  for (const s of extra) {
    if (!out.some((o) => key(o) === key(s))) out.push(s);
  }
  return out;
}
