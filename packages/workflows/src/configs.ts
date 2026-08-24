import { DEFAULT_POLICY, type Policy } from "@inspector/core";
import type { ExploreConfig, NativeExplorationConfig } from "@inspector/explore";
import type { HuntRequest } from "./types.js";

export function webExploreConfig(req: HuntRequest): ExploreConfig {
  return {
    seed: req.seed,
    maxActions: req.maxActions,
    maxWallMs: req.maxMinutes * 60_000,
    maxFindings: req.maxFindings,
    maxResets: 40,
    noveltyPlateauLimit: 50,
    reproducibleAttempts: 2,
    reproducibleMinSuccesses: 1,
    enableFaultInjection: false,
    observeFields: ["url", "title", "uiTree", "storage", "pageErrors", "screenshot"],
    targetUrl: req.targetUrl,
  };
}

export function nativeExploreConfig(req: HuntRequest): NativeExplorationConfig {
  return {
    seed: req.seed,
    maxActions: req.maxActions,
    maxWallMs: req.maxMinutes * 60_000,
    maxFindings: req.maxFindings,
    noveltyPlateauLimit: 40,
  };
}

export function fakeExploreConfig(req: HuntRequest): Omit<HuntRequest, "resumeRunId"> {
  const { resumeRunId: _resumeRunId, ...config } = req;
  return config;
}

/**
 * The exploration policy must never starve its own exploration budget: budgets
 * are raised to cover the requested action/wall budgets (a policy rejection
 * would otherwise silently refuse every action).
 */
export function huntPolicy(req: HuntRequest): Policy {
  const base = DEFAULT_POLICY;
  return {
    ...base,
    budgets: {
      ...base.budgets,
      max_actions: Math.max(base.budgets.max_actions, req.maxActions + 50),
      wall_clock_minutes: Math.max(base.budgets.wall_clock_minutes, req.maxMinutes + 2),
      max_environment_resets: Math.max(base.budgets.max_environment_resets, 60),
    },
  };
}
