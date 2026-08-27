import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  benchmarkFingerprintSkip,
  StateFile,
} from "../packages/scale/src/state-file.js";

// HARDENING_5 H5.7 manual benchmark (run: pnpm exec tsx scripts/perf-bench.ts).
// Captures the fingerprint no-op skip effect on StateFile.save: identical
// re-saves must skip fsync+rename and be far cheaper than changing saves.
// Uses the exported benchmarkFingerprintSkip harness so the script and
// state-file.bench.test.ts share the same deterministic measurement.
const dir = mkdtempSync(join(tmpdir(), "inspector-perf-"));
try {
  const sf = new StateFile<{ n: number; note: string }>(dir, "perf", () => ({
    n: 0,
    note: "",
  }));
  sf.update((c) => {
    c.n = 1;
  });

  const iterations = 5000;
  const result = benchmarkFingerprintSkip(
    sf,
    (c) => {
      c.n = 1;
    },
    (c, i) => {
      c.n = i;
    },
    iterations,
  );

  console.log(
    JSON.stringify(
      {
        iterations,
        noopPerSaveUs: Math.round(result.noopPerSaveUs),
        changingPerSaveUs: Math.round(result.changingPerSaveUs),
        speedup: Number(result.speedup.toFixed(2)),
        noopMs: Math.round(result.noopMs),
        changingMs: Math.round(result.changingMs),
        note: "H5.7 fingerprint skip: identical re-save skips fsync+rename",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
