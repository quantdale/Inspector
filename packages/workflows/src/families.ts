import type { AdapterFamily } from "@inspector/scale";

/** Windows UIA backend kinds, resolved identically by exploration provenance
 * recording and native reproduction-driver selection (H5-D3 single source). */
export async function resolveWindowsBackendKind(): Promise<"real" | "mock"> {
  const raw = process.env.INSPECTOR_WINDOWS_BACKEND;
  if (raw === "mock" || raw === "real") return raw;
  const { probeRealUia } = await import("../../windows-adapter/src/selection.js");
  return (await probeRealUia()) ? "real" : "mock";
}

/**
 * HARDENING_5 H5.5: the single canonical execution contract per adapter
 * family inside the workflow layer. `Record<AdapterFamily, ...>` makes a
 * family added to @inspector/scale a COMPILE error here until every layer
 * (explorer kind, spawn, durable identity, replay) declares its semantics —
 * the drift guard for the H5-D0 class (electron silently collapsing to fake).
 *
 * Identity is data, not inference: `durableAdapterId` is the adapter string
 * the spawned adapter process reports in its capability doc and that lands in
 * durable run/environment/finding/evidence records. Unknown values NEVER map
 * to fake; callers must refuse them before any run/workspace side effect.
 */
export interface FamilyExecutionContract {
  /** Legacy target aliases accepted for this family (validated input only). */
  readonly aliases: readonly string[];
  /** Explorer engine kind that drives the exploration loop. */
  readonly explorerKind: "web" | "native" | "fake";
  /**
   * Durable adapter identity recorded by the adapter's capability doc.
   * Electron reuses browser sensing semantics internally (its handler
   * delegates to web) but provenance stays Electron-specific.
   */
  readonly durableAdapterId: string;
  /** Adapter binary resolved by workspace.adapterBin (exact or typed refusal). */
  readonly binName: "web" | "fake" | "cli" | "windows" | "android" | "electron";
  /** True when ExploreController (browser-like semantics) drives the loop. */
  readonly browserLike: boolean;
}

export const FAMILY_CONTRACT: Record<AdapterFamily, FamilyExecutionContract> = {
  fake: {
    aliases: [],
    explorerKind: "fake",
    durableAdapterId: "adapter-fake",
    binName: "fake",
    browserLike: false,
  },
  web: {
    aliases: [],
    explorerKind: "web",
    durableAdapterId: "web-playwright",
    binName: "web",
    browserLike: true,
  },
  cli: {
    aliases: ["pty"],
    explorerKind: "native",
    durableAdapterId: "cli-pty",
    binName: "cli",
    browserLike: false,
  },
  windows: {
    aliases: ["uia"],
    explorerKind: "native",
    durableAdapterId: "windows-uia",
    binName: "windows",
    browserLike: false,
  },
  android: {
    aliases: [],
    explorerKind: "native",
    durableAdapterId: "android-uiautomator",
    binName: "android",
    browserLike: false,
  },
  electron: {
    aliases: [],
    explorerKind: "web",
    durableAdapterId: "electron-chromium",
    binName: "electron",
    browserLike: true,
  },
};

/**
 * Total explorer-kind lookup for any workflow-representable adapter.
 * Electron shares the browser-like web explorer while keeping electron
 * durable identity (H5 design decision).
 */
export function explorerKindOf(
  adapter: "web" | "fake" | "cli" | "windows" | "android" | "electron",
): FamilyExecutionContract["explorerKind"] {
  return FAMILY_CONTRACT[adapter].explorerKind;
}

/**
 * Resolve a validated work-item family (or legacy target alias) to its
 * contract. Returns undefined for unknown values — callers must fail closed
 * with a typed configuration refusal, never substitute another family.
 */
export function familyContractFor(rawFamily: string): FamilyExecutionContract | undefined {
  for (const contract of Object.values(FAMILY_CONTRACT)) {
    if (contract.binName === rawFamily || contract.aliases.includes(rawFamily)) {
      return contract;
    }
  }
  return undefined;
}
