import type { Finding } from "@inspector/finding";
import type { ResourceLedger } from "./ledger.js";
import type { AdapterRegistry } from "./discovery.js";

export interface FacadeRequest {
  method:
    | "campaign.status"
    | "findings.list"
    | "adapters.list"
    | "usage.summary"
    | "campaign.stop"
    | "campaign.resume";
  params?: Record<string, unknown>;
}

export interface FacadeResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * External integration facade (M7 S6). MCP-compatible request/response shape
 * exposing read-only campaign views plus a cooperative stop/resume pair.
 * External calls map through the same ledger/policy state — they can never
 * mutate durable findings or bypass worker leases. Stop is durable (it
 * survives restart); resume is the symmetric operator action that clears it.
 * Dependency failures are converted into error responses, never unhandled
 * throws.
 */
export class InspectorFacade {
  constructor(
    private readonly deps: {
      status: () => { running: boolean; queue: number; completed: number; inFlight: number };
      findings: () => Finding[];
      ledger: ResourceLedger;
      registry: AdapterRegistry;
      stop: () => void;
      resume: () => void;
    },
  ) {}

  async handle(req: FacadeRequest): Promise<FacadeResponse> {
    if (!req || typeof req.method !== "string") {
      return {
        ok: false,
        error: { code: "UNKNOWN_METHOD", message: String((req as { method?: unknown })?.method) },
      };
    }
    switch (req.method) {
      case "campaign.status":
        return this.attempt(() => this.deps.status());
      case "findings.list":
        return this.attempt(() =>
          this.deps.findings().map((f) => ({
            id: f.id,
            runId: f.runId,
            status: f.status,
            title: f.title,
            severity: f.severity,
            confidence: f.confidence,
          })),
        );
      case "usage.summary":
        return this.attempt(() => this.deps.ledger.totals());
      case "adapters.list":
        return this.attempt(() => ({
          compatible: this.deps.registry.discover().map((a) => ({ id: a.id, conformance: a.conformance })),
          incompatible: this.deps.registry.incompatible(),
        }));
      case "campaign.stop":
        return this.attempt(() => {
          this.deps.stop();
          return { stopping: true };
        });
      case "campaign.resume":
        return this.attempt(() => {
          this.deps.resume();
          return { resuming: true };
        });
      default:
        return { ok: false, error: { code: "UNKNOWN_METHOD", message: String(req.method) } };
    }
  }

  /** A throwing dependency becomes an error response, never an unhandled rejection. */
  private attempt(fn: () => unknown): FacadeResponse {
    try {
      return { ok: true, result: fn() };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "DEPENDENCY_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
