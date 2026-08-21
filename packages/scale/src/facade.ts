import type { Finding } from "@inspector/finding";
import type { ResourceLedger } from "./ledger.js";
import type { AdapterRegistry } from "./discovery.js";

export interface FacadeRequest {
  method:
    | "campaign.status"
    | "findings.list"
    | "adapters.list"
    | "usage.summary"
    | "campaign.stop";
  params?: Record<string, unknown>;
}

export interface FacadeResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * External integration facade (M7 S6). MCP-compatible request/response shape
 * exposing read-only campaign views plus a cooperative stop. External calls
 * map through the same ledger/policy state — they can never mutate durable
 * findings or bypass worker leases.
 */
export class InspectorFacade {
  constructor(
    private readonly deps: {
      status: () => { running: boolean; queue: number; completed: number; inFlight: number };
      findings: () => Finding[];
      ledger: ResourceLedger;
      registry: AdapterRegistry;
      stop: () => void;
    },
  ) {}

  async handle(req: FacadeRequest): Promise<FacadeResponse> {
    switch (req.method) {
      case "campaign.status":
        return { ok: true, result: this.deps.status() };
      case "findings.list":
        return {
          ok: true,
          result: this.deps.findings().map((f) => ({
            id: f.id,
            runId: f.runId,
            status: f.status,
            title: f.title,
            severity: f.severity,
            confidence: f.confidence,
          })),
        };
      case "usage.summary":
        return { ok: true, result: this.deps.ledger.totals() };
      case "adapters.list":
        return {
          ok: true,
          result: {
            compatible: this.deps.registry.discover().map((a) => ({ id: a.id, conformance: a.conformance })),
            incompatible: this.deps.registry.incompatible(),
          },
        };
      case "campaign.stop":
        this.deps.stop();
        return { ok: true, result: { stopping: true } };
      default:
        return { ok: false, error: { code: "UNKNOWN_METHOD", message: String((req as { method?: string }).method) } };
    }
  }
}
