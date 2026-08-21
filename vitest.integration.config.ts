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
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["packages/**/*.integration.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 60000,
  },
});
