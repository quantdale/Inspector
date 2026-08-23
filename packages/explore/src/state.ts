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
  /** Android (SPEC-009 W7): content-desc and structural path. */
  desc?: string;
  path?: string;
  clickable?: boolean;
  scrollable?: boolean;
  className?: string;
  /** Windows (SPEC-009 W6): evidenced surface-detaching control. */
  surfaceDetaching?: boolean;
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

export interface StateGraphSnapshot {
  version: 1;
  nodes: StateNode[];
  edges: Edge[];
  screenCounts: Array<[string, number]>;
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
      // (crashes, resets) must not rewrite established graph structure. A
      // null first target means the post-action observation was unavailable;
      // replace that unknown with the first durable target when it appears.
      if (e.leadsToState === null && toState !== null) e.leadsToState = toState;
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

  /** Fill an unknown first target after a delayed durable observation without
   * incrementing the traversal count a second time. */
  resolveEdgeTarget(fromState: string, actionKey: string, toState: string): void {
    const edge = this.edges.get(`${fromState}::${actionKey}`);
    if (edge?.leadsToState === null) edge.leadsToState = toState;
  }

  edgeCount(fromState: string, actionKey: string): number {
    return this.edges.get(`${fromState}::${actionKey}`)?.count ?? 0;
  }

  /** Deterministic, detached persistence representation. */
  snapshot(): StateGraphSnapshot {
    return {
      version: 1,
      nodes: [...this.nodes.values()]
        .map((n) => ({ ...n }))
        .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
      edges: [...this.edges.values()]
        .map((e) => ({ ...e }))
        .sort((a, b) =>
          `${a.fromState}::${a.actionKey}`.localeCompare(`${b.fromState}::${b.actionKey}`),
        ),
      screenCounts: [...this.screenCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }

  /** Restore a graph after validating every persisted scalar and key. */
  restore(snapshot: unknown): void {
    const parsed = validateGraphSnapshot(snapshot);
    this.nodes.clear();
    this.edges.clear();
    this.screenCounts.clear();
    for (const node of parsed.nodes) this.nodes.set(node.fingerprint, { ...node });
    for (const edge of parsed.edges) {
      this.edges.set(`${edge.fromState}::${edge.actionKey}`, { ...edge });
    }
    for (const [screen, count] of parsed.screenCounts) this.screenCounts.set(screen, count);
  }

  static fromSnapshot(snapshot: unknown): StateGraph {
    const graph = new StateGraph();
    graph.restore(snapshot);
    return graph;
  }

  get stateCount(): number {
    return this.nodes.size;
  }
}

function validateGraphSnapshot(value: unknown): StateGraphSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.screenCounts)) {
    throw new Error("invalid exploration state graph snapshot version or shape");
  }
  const nodes = value.nodes.map((raw) => {
    if (!isRecord(raw) || typeof raw.fingerprint !== "string" || typeof raw.screen !== "string") {
      throw new Error("invalid exploration graph node");
    }
    return {
      fingerprint: raw.fingerprint,
      screen: raw.screen,
      firstSeenActionIndex: finiteNonNegativeInt(raw.firstSeenActionIndex, "node firstSeenActionIndex"),
      visits: positiveInt(raw.visits, "node visits"),
      lastSeenActionIndex: finiteNonNegativeInt(raw.lastSeenActionIndex, "node lastSeenActionIndex"),
    } satisfies StateNode;
  });
  const nodeKeys = new Set<string>();
  for (const node of nodes) {
    if (nodeKeys.has(node.fingerprint)) throw new Error(`duplicate exploration graph node '${node.fingerprint}'`);
    nodeKeys.add(node.fingerprint);
  }
  const edges = value.edges.map((raw) => {
    if (!isRecord(raw) || typeof raw.fromState !== "string" || typeof raw.actionKey !== "string" || (raw.leadsToState !== null && typeof raw.leadsToState !== "string")) {
      throw new Error("invalid exploration graph edge");
    }
    const edge = {
      fromState: raw.fromState,
      actionKey: raw.actionKey,
      count: positiveInt(raw.count, "edge count"),
      lastSeenActionIndex: finiteNonNegativeInt(raw.lastSeenActionIndex, "edge lastSeenActionIndex"),
      leadsToState: raw.leadsToState,
    } satisfies Edge;
    if (!nodeKeys.has(edge.fromState)) {
      throw new Error(`exploration graph edge starts at missing node '${edge.fromState}'`);
    }
    if (edge.leadsToState !== null && !nodeKeys.has(edge.leadsToState)) {
      throw new Error(`exploration graph edge targets missing node '${edge.leadsToState}'`);
    }
    return edge;
  });
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.fromState}::${edge.actionKey}`;
    if (edgeKeys.has(key)) throw new Error(`duplicate exploration graph edge '${key}'`);
    edgeKeys.add(key);
  }
  const screenCounts = value.screenCounts.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string") {
      throw new Error("invalid exploration screen count");
    }
    return [raw[0], positiveInt(raw[1], "screen count")] as [string, number];
  });
  const screenKeys = new Set<string>();
  for (const [screen] of screenCounts) {
    if (screenKeys.has(screen)) throw new Error(`duplicate exploration screen '${screen}'`);
    screenKeys.add(screen);
  }
  return { version: 1, nodes, edges, screenCounts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegativeInt(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`invalid ${label}`);
  return value as number;
}

function positiveInt(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`invalid ${label}`);
  return value as number;
}
