import { createHash } from "node:crypto";
import type { Finding } from "@inspector/finding";

export interface ClusterMember {
  findingId: string;
  runId: string | null;
  workerId?: string;
  signature: string;
}

export interface FindingCluster {
  canonical: ClusterMember;
  members: ClusterMember[];
}

/**
 * Finding clustering (M7 S4). Duplicates are grouped by a stable signature:
 * oracle kind + normalized error text + reproducer shape. The first finding
 * stays canonical; every member keeps its provenance (run/worker) so no
 * evidence is lost.
 */
export class FindingClusterer {
  private readonly clusters = new Map<string, FindingCluster>();

  add(finding: Finding, meta: { workerId?: string; errorText?: string } = {}): FindingCluster {
    const signature = this.signatureOf(finding, meta.errorText);
    const member: ClusterMember = {
      findingId: finding.id,
      runId: finding.runId,
      workerId: meta.workerId,
      signature,
    };
    let cluster = this.clusters.get(signature);
    if (!cluster) {
      cluster = { canonical: member, members: [member] };
      this.clusters.set(signature, cluster);
    } else {
      cluster.members.push(member);
    }
    return cluster;
  }

  list(): FindingCluster[] {
    return [...this.clusters.values()];
  }

  get size(): number {
    return this.clusters.size;
  }

  private signatureOf(finding: Finding, errorText?: string): string {
    const normalized = (errorText ?? finding.title)
      .toLowerCase()
      .replace(/\d+/g, "#")
      .replace(/[^a-z#.]+/g, " ")
      .trim();
    const shape = `${[...finding.oracleIds].sort().join("|")}:${normalized}`;
    return createHash("sha256").update(shape).digest("hex").slice(0, 16);
  }
}
