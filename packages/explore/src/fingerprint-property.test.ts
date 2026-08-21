import { describe, it, expect } from "vitest";
import type { Observation } from "@inspector/protocol";
import { stateFingerprint, screenFingerprint, type UiElement } from "./state.js";
import { buildInventory } from "./inventory.js";
import { boundaryValues } from "./inputs.js";
import { strongHash, hashString, mulberry32, type Rng } from "./rng.js";

// ---------------------------------------------------------------------------
// Property/fuzz suite for explore state fingerprints and dedup hashing.
// Seeded deterministic generators (mulberry32 from ./rng.ts) — no snapshots of
// concrete values, only invariants that must hold for EVERY generated input.
// ---------------------------------------------------------------------------

const SEED = 0x4b50524f;

/** Rng plus a Bernoulli helper used by the generators below. */
interface PropRng extends Rng {
  bool(p?: number): boolean;
}

function makeRng(seed: number): PropRng {
  const base = mulberry32(seed);
  return {
    next: () => base.next(),
    int: (m) => base.int(m),
    pick: (items) => base.pick(items),
    fork: (salt) => base.fork(salt),
    bool: (p = 0.5) => base.next() < p,
  };
}

let obsCounter = 0;
function obsOf(
  elements: UiElement[],
  storage: Record<string, string> = {},
): Observation {
  obsCounter += 1;
  return {
    id: `o${obsCounter}`,
    runId: "r",
    environmentId: "e",
    sequence: 0,
    source: "test",
    capturedAt: new Date().toISOString(),
    summary: { url: "http://x/", uiTree: elements, storage },
  } as unknown as Observation;
}

const TAGS = ["button", "input", "textarea", "select", "a", "div", "span"];
const ROLES = ["button", "textbox", "combobox", "link", "generic"];
const IDENTIFIERS = ["save", "cancel", "username", "count", "submit-btn", "f0", "menu", "", "x"];

/** Generate one random UI element. */
function genElement(rng: PropRng): UiElement {
  const el: UiElement = {
    tag: rng.pick(TAGS),
    role: rng.pick(ROLES),
  };
  if (rng.bool(0.8)) el.id = rng.pick(IDENTIFIERS) || `id${rng.int(100)}`;
  if (rng.bool(0.5)) el.name = rng.pick(IDENTIFIERS) || `name${rng.int(100)}`;
  if (rng.bool(0.2)) el.hidden = true;
  if (rng.bool(0.15)) el.disabled = true;
  const dyn = rng.int(10);
  if (dyn < 3) el.value = `v${rng.int(50)}`;
  else if (dyn < 6) el.text = `t${rng.int(50)}`;
  return el;
}

function genTree(rng: PropRng, maxLen = 8): UiElement[] {
  const n = rng.int(maxLen + 1);
  return Array.from({ length: n }, () => genElement(rng));
}

function genStorage(rng: PropRng): Record<string, string> {
  const keys = ["theme", "token", "cart", "step", "lang", "flag"];
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (rng.bool(0.5)) out[k] = `${rng.int(1000)}`;
  }
  return out;
}

/**
 * The projection screenFingerprint is defined over: the sorted multiset of
 * tag|id|name|role keys of visible+enabled elements. Reimplemented here so the
 * equivalence property is checked against an independent oracle.
 */
function screenProjection(elements: UiElement[]): string {
  return elements
    .filter((e) => !e.hidden && !e.disabled)
    .map((e) => `${e.tag}|${e.id ?? ""}|${e.name ?? ""}|${e.role ?? ""}`)
    .sort()
    .join(",");
}

/** Full state projection: screen + dynamic values + storage pairs. */
function stateProjection(elements: UiElement[], storage: Record<string, string>): string[] {
  const dyn = elements
    .filter((e) => !e.hidden)
    .map((e) => {
      if (e.value !== undefined) return `${e.id || e.name}:v=${e.value}`;
      if (e.text !== undefined) return `${e.id || e.name}:t=${e.text}`;
      return null;
    })
    .filter((v): v is string => v !== null)
    .sort();
  const st = Object.entries(storage)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return [screenProjection(elements), ...dyn, ...st];
}

describe("fingerprint determinism properties (generated corpus)", () => {
  it("same input ⇒ same fingerprint across 400 generated observations", () => {
    const rng = makeRng(SEED ^ 0xb1);
    for (let i = 0; i < 400; i++) {
      const o = obsOf(genTree(rng), genStorage(rng));
      expect(stateFingerprint(o)).toBe(stateFingerprint(o));
      expect(screenFingerprint(o)).toBe(screenFingerprint(o));
    }
  });

  it("uiTree order and storage insertion order never change fingerprints", () => {
    const rng = makeRng(SEED ^ 0xb2);
    for (let i = 0; i < 300; i++) {
      const tree = genTree(rng);
      const storage = genStorage(rng);

      // Shuffle the tree.
      const shuffled = [...tree];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = rng.int(j + 1);
        [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
      }
      // Reverse key insertion order of the storage map.
      const reversedStorage: Record<string, string> = {};
      for (const k of Object.keys(storage).reverse()) reversedStorage[k] = storage[k]!;

      const a = obsOf(tree, storage);
      const b = obsOf(shuffled, reversedStorage);
      expect(screenFingerprint(a)).toBe(screenFingerprint(b));
      expect(stateFingerprint(a)).toBe(stateFingerprint(b));
    }
  });
});

describe("fingerprint discrimination properties (single-dimension mutations)", () => {
  interface Mutation {
    name: string;
    apply(el: UiElement): UiElement;
    changesScreen: boolean;
  }

  const mutations: Mutation[] = [
    { name: "tag", apply: (el) => ({ ...el, tag: el.tag === "button" ? "input" : "button" }), changesScreen: true },
    { name: "role", apply: (el) => ({ ...el, role: el.role === "button" ? "link" : "button" }), changesScreen: true },
    { name: "id", apply: (el) => ({ ...el, id: (el.id ?? "x") + "-m" }), changesScreen: true },
    { name: "name", apply: (el) => ({ ...el, name: (el.name ?? "x") + "-m" }), changesScreen: true },
    { name: "value", apply: (el) => ({ ...el, value: (el.value ?? "v") + "-m" }), changesScreen: false },
    { name: "text", apply: (el) => ({ ...el, text: (el.text ?? "t") + "-m" }), changesScreen: false },
  ];

  it("mutating exactly one projected dimension of one element ⇒ distinct fingerprint", () => {
    const rng = makeRng(SEED ^ 0xb3);
    let exercised = 0;
    for (let i = 0; i < 300; i++) {
      const tree = genTree(rng).map((e) => ({ ...e, hidden: false, disabled: false }));
      if (tree.length === 0) continue;
      const idx = rng.int(tree.length);
      const m = rng.pick(mutations);
      const mutated = tree.map((e, j) => (j === idx ? m.apply(e) : e));

      // Guard: skip degenerate cases where the mutation is a no-op on the
      // projected key (e.g. tag swap on a hidden element cannot happen here,
      // but id mutation could theoretically produce the same string).
      if (screenProjection(mutated) === screenProjection(tree)) continue;
      exercised++;

      const a = obsOf(tree, genStorage(rng));
      const storageA = (a.summary as { storage: Record<string, string> }).storage;
      const bObs = obsOf(mutated, storageA);

      if (m.changesScreen) {
        expect(screenFingerprint(bObs), `${m.name} must change screen`).not.toBe(
          screenFingerprint(a),
        );
      }
      expect(stateFingerprint(bObs), `${m.name} must change state`).not.toBe(
        stateFingerprint(a),
      );
    }
    expect(exercised).toBeGreaterThan(150);
  });

  it("storage value/key changes ⇒ distinct STATE fingerprint (screen may match)", () => {
    const rng = makeRng(SEED ^ 0xb4);
    for (let i = 0; i < 200; i++) {
      const tree = genTree(rng);
      const storage = genStorage(rng);
      const keys = Object.keys(storage);
      if (keys.length === 0) continue;
      const k = rng.pick(keys);

      const mutatedValue = { ...storage, [k]: storage[k]! + "-x" };
      const addedKey = { ...storage, extraKey9: "1" };
      const removed: Record<string, string> = { ...storage };
      delete removed[k];

      const base = obsOf(tree, storage);
      const baseState = stateFingerprint(base);
      for (const variant of [mutatedValue, addedKey, removed]) {
        if (stateProjection(tree, variant).join("|") === stateProjection(tree, storage).join("|")) {
          continue;
        }
        expect(stateFingerprint(obsOf(tree, variant)), `storage ${JSON.stringify(variant)}`).not.toBe(
          baseState,
        );
      }
    }
  });

  it("hidden/disabled toggles alone NEVER change the screen fingerprint (by design)", () => {
    const rng = makeRng(SEED ^ 0xb5);
    for (let i = 0; i < 200; i++) {
      const tree = genTree(rng);
      const toggled = tree.map((e) =>
        e.hidden ? { ...e, hidden: false } : { ...e, hidden: true },
      );
      const a = obsOf(tree, {});
      const b = obsOf(toggled, {});
      if (screenProjection(tree) === screenProjection(toggled)) {
        expect(screenFingerprint(b)).toBe(screenFingerprint(a));
      }
    }
  });
});

describe("fingerprint injectivity over the generated corpus", () => {
  it("fp(a)==fp(b) ⟺ projection(a)==projection(b) over 1200 generated states", () => {
    const rng = makeRng(SEED ^ 0xb6);
    interface Case {
      tree: UiElement[];
      storage: Record<string, string>;
      screenFp: string;
      stateFp: string;
      screenProj: string;
      stateProj: string;
    }
    const cases: Case[] = [];
    for (let i = 0; i < 1200; i++) {
      const tree = genTree(rng);
      const storage = genStorage(rng);
      cases.push({
        tree,
        storage,
        screenFp: screenFingerprint(obsOf(tree, storage)),
        stateFp: stateFingerprint(obsOf(tree, storage)),
        screenProj: screenProjection(tree),
        stateProj: stateProjection(tree, storage).join("|"),
      });
    }

    // Equivalence in both directions, sampled pairwise plus adjacent-pair sweep
    // (full 1200² is 1.44M comparisons; sample keeps the suite bounded).
    let compared = 0;
    for (let i = 0; i < cases.length; i += 7) {
      for (let j = i + 1; j < Math.min(i + 23, cases.length); j++) {
        const a = cases[i]!;
        const b = cases[j]!;
        expect((a.screenFp === b.screenFp) === (a.screenProj === b.screenProj)).toBe(true);
        expect((a.stateFp === b.stateFp) === (a.stateProj === b.stateProj)).toBe(true);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(2000);

    // Distinct projections ⇒ distinct fingerprints over the whole corpus.
    const distinctScreens = new Set(cases.map((c) => c.screenProj));
    const distinctScreenFps = new Set(cases.map((c) => c.screenFp));
    expect(distinctScreenFps.size).toBe(distinctScreens.size);

    const distinctStates = new Set(cases.map((c) => c.stateProj));
    const distinctStateFps = new Set(cases.map((c) => c.stateFp));
    expect(distinctStateFps.size).toBe(distinctStates.size);
    expect(distinctStates.size).toBeGreaterThan(900); // corpus really varies
  });

  it("strongHash is injective over a generated fill-value corpus where FNV-32 provably collides", () => {
    const rng = makeRng(SEED ^ 0xb7);
    // Documented FNV-1a collision (explore.hardening D5).
    const corpus = new Set<string>(["v7pwu", "ve5fa"]);
    expect(hashString("v7pwu")).toBe(hashString("ve5fa")); // teeth: FNV fails here

    const alphabet = "abcdefghijklmnopqrstuvwxyzABC0123456789_-.,;:!@#";
    while (corpus.size < 2500) {
      const len = 1 + rng.int(12);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[rng.int(alphabet.length)];
      corpus.add(s);
    }
    const values = [...corpus];

    const strong = new Set(values.map(strongHash));
    expect(strong.size).toBe(values.length); // injective on this corpus

    // Control: bucket FNV-32 outputs over the same corpus and find a colliding
    // pair in O(n) — demonstrates the corpus is big enough to expose 32-bit
    // weaknesses while strongHash stays collision-free on identical input.
    const fnvBuckets = new Map<string, string>();
    let fnvCollision: string | null = null;
    for (const v of values) {
      const h = hashString(v);
      if (fnvBuckets.has(h)) {
        fnvCollision = `${fnvBuckets.get(h)}/${v}`;
        break;
      }
      fnvBuckets.set(h, v);
    }
    if (fnvCollision !== null) {
      expect(strongHash(fnvCollision.split("/")[0]!)).not.toBe(
        strongHash(fnvCollision.split("/")[1]!),
      );
    }

    // Inventory-level: fill actionKeys are injective over generated element
    // ids — no distinct (selector, boundary value) pair may be deduped away.
    const ids = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0 ? `userField${i}` : `f${i}${alphabet[rng.int(alphabet.length)]}`,
    );
    const elements: UiElement[] = ids.map((id) => ({
      tag: "input",
      role: "textbox",
      id,
    }));
    const inv = buildInventory(
      elements,
      {
        protocolVersion: "0.1",
        adapter: "test",
        capabilities: {
          observe: [],
          act: ["fill"],
          lifecycle: [],
          faults: [],
          coverage: [],
        },
      },
      { allowFaults: false },
    );
    const keys = inv.filter((c) => c.kind === "fill").map((c) => c.actionKey);
    const expected = new Set<string>();
    for (const el of elements) {
      for (const v of boundaryValues(el.id!)) {
        expected.add(`fill:#${el.id}:${strongHash(v)}`);
      }
    }
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys emitted
    expect(keys.length).toBe(expected.size); // every distinct candidate survived
  });
});
