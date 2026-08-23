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
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["packages/**/*.integration.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 60000,
    // Cold Chromium/emulator spawns under concurrent file execution can
    // exceed the 10s default beforeAll budget on Windows; observed as
    // random per-file "Hook timed out" flakes across full-suite runs.
    hookTimeout: 30000,
  },
});
