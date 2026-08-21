import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { Store } from "@inspector/store-sqlite";
import { ArtifactStore } from "@inspector/artifact-store";
import { RunManager } from "@inspector/core";
import { FindingEngine, OracleEngine } from "@inspector/finding";
import { ExploreController } from "@inspector/explore";
import {
  webAdapterSpawn,
  startSeedServer,
  type SeedServer,
} from "@inspector/adapter-web";

/**
 * Regression coverage for the dogfood hunt failure against the vendored
 * React TodoMVC (class/placeholder-only DOM, no ids or aria-labels): the
 * explorer generated ZERO interaction candidates there and degenerated to
 * back/forward/reload/wait. These fixtures mirror that DOM shape inline so
 * the test stays hermetic.
 */

const REACT_LIKE_HTML = `<!doctype html><html><head><title>Mini Todo</title></head><body>
<div id="root">
  <input class="new-todo" placeholder="What needs to be done?">
  <ul class="todo-list"></ul>
  <footer class="footer" hidden>
    <a href="#all">All</a>
    <a href="#active">Active</a>
    <a href="#completed">Completed</a>
    <button class="clear-completed">Clear completed</button>
  </footer>
</div>
<script>
(function () {
  var input = document.querySelector('.new-todo');
  var list = document.querySelector('.todo-list');
  var footer = document.querySelector('.footer');
  var todos = [];
  function render() {
    list.innerHTML = '';
    todos.forEach(function (t, i) {
      var li = document.createElement('li');
      li.textContent = t;
      var del = document.createElement('button');
      del.className = 'destroy';
      del.textContent = 'x';
      del.onclick = function () { todos.splice(i, 1); render(); };
      li.appendChild(del);
      list.appendChild(li);
    });
    footer.hidden = todos.length === 0;
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && input.value.trim()) {
      todos.push(input.value.trim());
      input.value = '';
      render();
    }
  });
  Array.prototype.forEach.call(footer.querySelectorAll('a'), function (a) {
    a.onclick = function () {
      localStorage.setItem('filter', a.textContent);
      render();
    };
  });
  document.querySelector('.clear-completed').onclick = function () {};
})();
</script></body></html>`;

/** Backbone-era markup style: every control carries a stable id. */
const BACKBONE_STYLE_HTML = `<!doctype html><html><head><title>Counter</title></head><body>
<div id="app">
  <input id="new-item" placeholder="Item">
  <button id="add-btn">Add</button>
  <button id="reset-btn">Reset</button>
  <ul id="items"></ul>
</div>
<script>
(function () {
  var items = [];
  var input = document.getElementById('new-item');
  var list = document.getElementById('items');
  function render() {
    list.innerHTML = '';
    items.forEach(function (t, i) {
      var li = document.createElement('li');
      li.textContent = t;
      li.setAttribute('data-id', String(i));
      list.appendChild(li);
    });
  }
  document.getElementById('add-btn').onclick = function () {
    if (input.value.trim()) { items.push(input.value.trim()); input.value = ''; render(); }
  };
  document.getElementById('reset-btn').onclick = function () { items = []; render(); };
})();
</script></body></html>`;

const servers: SeedServer[] = [];

afterAll(() => {
  for (const s of servers) s.close();
});

async function serve(html: string): Promise<string> {
  const s = startSeedServer({ html });
  servers.push(s);
  await s.ready;
  return s.url;
}

interface RunSummary {
  kinds: string[];
  statesVisited: number;
  stoppedReason: string;
}

async function explore(url: string, seed: number): Promise<RunSummary> {
  const base = mkdtempSync(join(tmpdir(), "insp-generic-dom-"));
  const store = Store.open(join(base, "runs.db"));
  try {
    const artifacts = new ArtifactStore(join(base, "artifacts"));
    const mgr = new RunManager(store, artifacts);
    const run = await mgr.startRun({
      ...webAdapterSpawn(),
      createOptions: { targetUrl: url },
    });
    const findingEngine = new FindingEngine(OracleEngine.defaults(), store);
    const controller = new ExploreController({
      run,
      findingEngine,
      config: {
        seed,
        maxActions: 80,
        maxWallMs: 120000,
        maxResets: 10,
        skipReproduction: true,
        noveltyPlateauLimit: 50,
      },
    });
    const result = await controller.run_();
    await run.close();
    return {
      kinds: result.actionKindSequence,
      statesVisited: result.statesVisited,
      stoppedReason: result.stoppedReason,
    };
  } finally {
    store.close();
  }
}

describe("exploration over generic external DOM", () => {
  it("interacts (fill/click/press) on a React-like id-less form app and visits >=5 states", async () => {
    const url = await serve(REACT_LIKE_HTML);
    const r = await explore(url, 20260821);
    const interactions = r.kinds.filter((k) =>
      k === "click" || k === "fill" || k === "press" || k === "select",
    );
    expect(interactions.length, `kinds=${r.kinds.join(",")}`).toBeGreaterThan(0);
    expect(r.statesVisited).toBeGreaterThanOrEqual(5);
  }, 300000);

  it("still interacts on Backbone-style id-bearing markup", async () => {
    const url = await serve(BACKBONE_STYLE_HTML);
    const r = await explore(url, 7);
    const interactions = r.kinds.filter((k) =>
      k === "click" || k === "fill" || k === "press" || k === "select",
    );
    expect(interactions.length, `kinds=${r.kinds.join(",")}`).toBeGreaterThan(0);
    expect(r.statesVisited).toBeGreaterThanOrEqual(2);
  }, 300000);
});
