import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@inspector/protocol";
import { WebAdapterHandler } from "./web-adapter.js";

// ---------------------------------------------------------------------------
// Strengthens the D3 late-throw cluster: pins the pageerror-during-action-
// window classification in BOTH directions.
//
//   K1  a pageerror landing while an automation call is failing (Playwright
//       timeout) must classify TARGET_FAILURE with the crash message — this
//       is the catch-path window slice (`errorsBefore` marker);
//   K2  a pageerror that landed strictly BEFORE the action window must NOT
//       leak into the outcome (still ACTION_FAILED) — the slice discipline
//       must not over-attribute unrelated crashes to a later action.
//
// K1 kills the mutant where the catch-path classification is removed.
// ---------------------------------------------------------------------------

const ART_BASE = join(tmpdir(), "inspector-web-window");

function act(id: string, kind: string, input?: Record<string, unknown>): Action {
  return {
    id,
    runId: "run",
    environmentId: "env",
    kind,
    risk: "interact",
    deadlineMs: 6000,
    idempotency: "safe-retry",
    input,
  } as Action;
}

let handler: WebAdapterHandler | null = null;
afterEach(async () => {
  if (handler) {
    await handler.lifecycle({ op: "close" }).catch(() => {});
    handler = null;
  }
});

async function fresh(seedHtml: string): Promise<WebAdapterHandler> {
  handler = new WebAdapterHandler({}, ART_BASE, seedHtml);
  await handler.lifecycle({ op: "create" });
  return handler;
}

describe("web hardening: pageerror action-window attribution", () => {
  it("K1: pageerror arriving DURING a failing action classifies TARGET_FAILURE", async () => {
    const h = await fresh(`<!doctype html><html><body><script>
      // Crash fires shortly after load, i.e. while the upcoming click on the
      // missing element is still waiting for its Playwright timeout.
      setTimeout(function () { throw new Error('ConcurrentCrash'); }, 25);
    </script></body></html>`);

    const outcome = await h.act({
      action: act("k1", "click", { selector: "#does-not-exist" }),
    });

    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("TARGET_FAILURE");
    expect(outcome.error?.message).toContain("ConcurrentCrash");
  }, 20000);

  it("K2: a pageerror from BEFORE the action window stays ACTION_FAILED", async () => {
    const h = await fresh(`<!doctype html><html><body><script>
      setTimeout(function () { throw new Error('EarlierCrash'); }, 20);
    </script></body></html>`);

    // Let the crash land and settle BEFORE opening the action window.
    await new Promise((r) => setTimeout(r, 500));

    const outcome = await h.act({
      action: act("k2", "click", { selector: "#also-missing" }),
    });

    expect(outcome.status).toBe("target-failure");
    expect(outcome.error?.code).toBe("ACTION_FAILED");
    expect(outcome.error?.message).not.toContain("EarlierCrash");
  }, 20000);
});
