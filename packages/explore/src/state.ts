import type { Observation } from "@inspector/protocol";
import { strongHash } from "./rng.js";

export interface UiElement {
  tag: string;
  role: string;
  name?: string;
  id?: string;
  hidden?: boolean;
  disabled?: boolean;
  value?: string;
  text?: string;
}

export function uiTreeOf(obs: Observation): UiElement[] {
  const summary = obs.summary as { uiTree?: UiElement[] };
  return Array.isArray(summary?.uiTree) ? summary.uiTree : [];
}

/**
 * Coarse screen identity: the sorted set of currently *visible, enabled*
 * interactive elements, keyed by tag|id|name|role so an id-identified button
 * and a name-identified input never collapse into one screen. The seeded
 * single-page app keeps the same URL across screens, so screen identity must
 * come from the visible control set.
 */
export function screenFingerprint(obs: Observation): string {
  const els = uiTreeOf(obs)
    .filter((e) => !e.hidden && !e.disabled)
    .map((e) => `${e.tag}|${e.id ?? ""}|${e.name ?? ""}|${e.role ?? ""}`)
    .sort();
  return `scr|${els.join(",")}`;
}

/**
 * Fine state identity: the coarse screen plus the dynamic values of visible
 * fields/elements and a hash of the storage key/value pairs. Two observations
 * with the same fingerprint are treated as the same state for cycle/visitation
 * accounting; states that differ only in storage VALUES stay distinct.
 */
export function stateFingerprint(obs: Observation): string {
  const summary = obs.summary as {
    uiTree?: UiElement[];
    storage?: Record<string, string>;
  };
  const screen = screenFingerprint(obs);
  const dyn = uiTreeOf(obs)
    .filter((e) => !e.hidden)
    .map((e) => {
      if (e.value !== undefined) return `${e.id || e.name}:v=${e.value}`;
      if (e.text !== undefined) return `${e.id || e.name}:t=${e.text}`;
      return null;
    })
    .filter(Boolean)
    .sort()
    .join(",");
  const storage = strongHash(
    Object.entries(summary?.storage ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join(","),
  );
  return `${screen}#${dyn}#st:${storage}`;
}

export interface StateNode {
  fingerprint: string;
  screen: string;
  firstSeenActionIndex: number;
  visits: number;
  lastSeenActionIndex: number;
}

export interface Edge {
  fromState: string;
  actionKey: string;
  count: number;
  lastSeenActionIndex: number;
  leadsToState: string | null;
}

/** Evolving normalized state/action graph used for visitation and cycle accounting. */
export class StateGraph {
  readonly nodes = new Map<string, StateNode>();
  readonly edges = new Map<string, Edge>();
  readonly screenCounts = new Map<string, number>();

  visitState(
    fingerprint: string,
    screen: string,
    actionIndex: number,
  ): boolean {
    const existing = this.nodes.get(fingerprint);
    if (existing) {
      existing.visits += 1;
      existing.lastSeenActionIndex = actionIndex;
      this.screenCounts.set(screen, (this.screenCounts.get(screen) ?? 0) + 1);
      return false;
    }
    this.nodes.set(fingerprint, {
      fingerprint,
      screen,
      firstSeenActionIndex: actionIndex,
      visits: 1,
      lastSeenActionIndex: actionIndex,
    });
    this.screenCounts.set(screen, (this.screenCounts.get(screen) ?? 0) + 1);
    return true;
  }

  recordEdge(
    fromState: string,
    actionKey: string,
    toState: string | null,
    actionIndex: number,
  ): void {
    const key = `${fromState}::${actionKey}`;
    const e = this.edges.get(key);
    if (e) {
      e.count += 1;
      e.lastSeenActionIndex = actionIndex;
      // leadsToState keeps its FIRST target: later traversals may be transient
      // (crashes, resets) and must not rewrite established graph structure.
    } else {
      this.edges.set(key, {
        fromState,
        actionKey,
        count: 1,
        lastSeenActionIndex: actionIndex,
        leadsToState: toState,
      });
    }
  }

  edgeCount(fromState: string, actionKey: string): number {
    return this.edges.get(`${fromState}::${actionKey}`)?.count ?? 0;
  }

  get stateCount(): number {
    return this.nodes.size;
  }
}
