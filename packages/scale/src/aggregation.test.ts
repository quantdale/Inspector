import { describe, expect, it } from "vitest";
import type { Finding } from "@inspector/finding";
import { FindingClusterer, summarizeFindings } from "./index.js";

function finding(id: string, status: Finding["status"], title: string): Finding {
  return {
    id,
    runId: "run-1",
    status,
    title,
    confidence: 0.9,
    severity: "high",
    revision: null,
    oracleIds: ["oracle-a"],
    reproduction: null,
    artifactRefs: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

describe("M12 F7: campaign finding aggregation", () => {
  it("summarizes lifecycle classes and clusters duplicates without losing members", () => {
    const findings = [
      finding("f1", "CONFIRMED", "crash on submit"),
      finding("f2", "CONFIRMED", "crash on submit"), // same signature -> duplicate member
      finding("f3", "CANDIDATE", "odd state observed"),
      finding("f4", "REJECTED", "not reproducible"),
      finding("f5", "FLAKY", "sometimes reproduces"),
      finding("f6", "RESOLVED", "fixed elsewhere"),
    ];
    const clusterer = new FindingClusterer();
    for (const f of findings) clusterer.add(f, { errorText: f.title });
    const summary = summarizeFindings(findings, clusterer);
    expect(summary).toMatchObject({
      total: 6,
      confirmed: 2,
      candidates: 1,
      rejected: 1,
      flaky: 1,
      resolved: 1,
      other: 0,
      duplicateMembers: 1,
      clusters: 5,
    });
    // Evidence preservation: both confirmed findings remain in the input and
    // both stay members of their cluster.
    const crashCluster = clusterer.list().find((c) => c.members.length === 2)!;
    expect(crashCluster.members.map((m) => m.findingId).sort()).toEqual(["f1", "f2"]);
  });

  it("reports zero-class summaries for empty campaigns", () => {
    const summary = summarizeFindings([], new FindingClusterer());
    expect(summary.total).toBe(0);
    expect(summary.clusters).toBe(0);
    expect(summary.duplicateMembers).toBe(0);
  });
});
