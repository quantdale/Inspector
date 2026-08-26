import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateFile } from "../packages/scale/src/state-file.js";

// HARDENING_5 H5.7 manual benchmark (run: pnpm exec tsx scripts/perf-bench.ts).
// Captures the set-fingerprint no-op skip effect on StateFile.save: identical
// re-saves must skip fsync+rename and be far cheaper than changing saves.
const dir = mkdtempSync(join(tmpdir(), "inspector-perf-"));
try {
  const sf = new StateFile<{ n: number; note: string }>(dir, "perf", () => ({ n: 0, note: "" }));
  sf.update((c) => {
    c.n = 1;
  });

  const N = 5000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    sf.update((c) => {
      c.n = 1;
    });
  }
  const noopMs = Date.now() - t0;

  const t1 = Date.now();
  for (let i = 0; i < N; i++) {
    sf.update((c) => {
      c.n = i;
    });
  }
  const changeMs = Date.now() - t1;

  console.log(
    JSON.stringify(
      {
        noopPerSaveUs: Math.round((noopMs / N) * 1000),
        changingPerSaveUs: Math.round((changeMs / N) * 1000),
        speedup: Number((changeMs / Math.max(noopMs, 1)).toFixed(2)),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
