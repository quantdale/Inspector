import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const alias = {
  "@inspector/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
  "@inspector/store-sqlite": resolve(
    __dirname,
    "packages/store-sqlite/src/index.ts",
  ),
  "@inspector/artifact-store": resolve(
    __dirname,
    "packages/artifact-store/src/index.ts",
  ),
  "@inspector/adapter-sdk": resolve(
    __dirname,
    "packages/adapter-sdk/src/index.ts",
  ),
  "@inspector/adapter-fake": resolve(
    __dirname,
    "packages/adapter-fake/src/index.ts",
  ),
  "@inspector/core": resolve(__dirname, "packages/core/src/index.ts"),
  "@inspector/cli": resolve(__dirname, "packages/cli/src/index.ts"),
  "@inspector/finding": resolve(__dirname, "packages/finding/src/index.ts"),
  "@inspector/explore": resolve(__dirname, "packages/explore/src/index.ts"),
  "@inspector/oracle": resolve(__dirname, "packages/oracle/src/index.ts"),
  "@inspector/repair": resolve(__dirname, "packages/repair/src/index.ts"),
  "@inspector/scale": resolve(__dirname, "packages/scale/src/index.ts"),
  "@inspector/workflows": resolve(__dirname, "packages/workflows/src/index.ts"),
  "@inspector/adapter-web": resolve(__dirname, "packages/adapter-web/src/index.ts"),
  "@inspector/cli-adapter": resolve(__dirname, "packages/cli-adapter/src/index.ts"),
  "@inspector/windows-adapter": resolve(__dirname, "packages/windows-adapter/src/index.ts"),
  "@inspector/android": resolve(__dirname, "packages/android/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["packages/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**"],
    environment: "node",
    pool: "forks",
    // Spawn-heavy unit tests (git worktree CLI, headless Chromium, fuzz
    // child channels) exceed the 5s default per-test budget when the whole
    // suite forks in parallel on Windows: each fork competes for CPU and a
    // single git/chromium operation chain can blow its own budget. Calibrated
    // for that contention (not per-test inflation, assertions untouched);
    // every affected file also passes isolated.
    testTimeout: 15000,
    // Cap fork fan-out so process-spawn-heavy files keep scheduling headroom
    // (12 logical cores; unbounded forking oversubscribes them).
    poolOptions: { forks: { minForks: 2, maxForks: 6 } },
  },
});
