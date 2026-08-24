import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createTerminalCoverageReport } from "@lervo/diagnostics";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const projectId = "prj_terminal_coverage";
const policyVersion = `sha256:${"a".repeat(64)}`;
const contentHash = `sha256:${"b".repeat(64)}`;
const sessionDigest = `sha256:${"c".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(): Promise<SQLiteEventStore> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-coverage-"));
  roots.push(root);
  return SQLiteEventStore.open({ path: resolve(root, "events.sqlite"), projectId });
}

describe("unmanaged terminal context coverage", () => {
  it("projects prepared and explicit-reference evidence without promoting it to managed delivery", async () => {
    const events = await store();
    const common = {
      projectId,
      runId: "run_unmanaged_0123456789abcdef01234567",
      sessionId: "ses_unmanaged_0123456789abcdef01234567",
      actor: { kind: "provider" as const, provider: "codex" as const },
      schemaVersion: 1 as const,
      policyVersion,
    };
    events.append({
      ...common,
      eventId: "evt_context_01234567",
      type: "terminal.context.prepared",
      occurredAt: "2026-08-24T00:00:00Z",
      payload: {
        observationId: "tobs_context_01234567",
        executionMode: "unmanaged",
        providerSessionDigest: sessionDigest,
        providerTurnDigest: null,
        sourceSnapshotId: `ksnap_${"d".repeat(24)}`,
        repositoryRevision: `sha256:${"9".repeat(64)}`,
        queryDigest: `sha256:${"e".repeat(64)}`,
        contextHash: `sha256:${"f".repeat(64)}`,
        recommendationCount: 2,
        loadedDocuments: [{ conceptId: `concept_${"1".repeat(24)}`, path: "docs/knowledge/cache.md", contentHash, scope: "full", deliveredByteCount: 42, assurance: "human_reviewed", freshness: "current" }],
        workstreamId: null,
        workstreamRevision: null,
        workstreamSnapshotHash: null,
        workstreamScope: null,
        workstreamDeliveredByteCount: null,
      },
    });
    events.append({
      ...common,
      eventId: "evt_reference_01234567",
      type: "terminal.reference.observed",
      occurredAt: "2026-08-24T00:00:01Z",
      payload: {
        observationId: "tobs_reference_01234567",
        contextEventId: "evt_context_01234567",
        conceptId: `concept_${"1".repeat(24)}`,
        path: "docs/knowledge/cache.md",
        contentHash,
        scope: "full",
        referenceKind: "output_citation",
        providerSessionDigest: sessionDigest,
        providerTurnDigest: null,
      },
    });
    events.append({
      ...common,
      eventId: "evt_turn_01234567",
      type: "terminal.turn.observed",
      occurredAt: "2026-08-24T00:00:02Z",
      payload: {
        observationId: "tobs_turn_01234567",
        contextEventId: "evt_context_01234567",
        referenceEventIds: ["evt_reference_01234567"],
        referenceCount: 1,
        referenceTelemetry: "observed",
        lifecycleStatus: "current",
        completionResult: "allowed",
        repositoryRevisionBefore: `sha256:${"9".repeat(64)}`,
        repositoryRevisionAfter: `sha256:${"9".repeat(64)}`,
        repositoryChanged: false,
        finalWorkstreamId: null,
        finalWorkstreamRevision: null,
        finalWorkstreamSnapshotHash: null,
        providerSessionDigest: sessionDigest,
        providerTurnDigest: null,
      },
    });

    const report = createTerminalCoverageReport({ projectId, events, provider: "codex" });
    expect(report.reports).toHaveLength(1);
    expect(report.reports[0]).toMatchObject({
      executionMode: "unmanaged",
      capabilities: { hookContextPreparation: "observed", providerContextAcceptance: "unsupported", explicitOutputReference: "observed", internalUse: "unsupported" },
      documents: [{ highestObservation: "referenced", referenceKinds: ["output_citation"] }],
      coverage: {
        candidatePreparation: { numerator: 1, denominator: 2, value: 0.5, reason: null },
        managedDelivery: { numerator: 0, denominator: 1, value: null, reason: "unmanaged_no_adapter_receipt" },
        explicitReference: { numerator: 1, denominator: 1, value: 1, reason: null },
      },
      completion: { result: "allowed", lifecycleStatus: "current" },
    });
    events.close();
  });

  it("marks reference coverage unavailable before a Stop event", async () => {
    const events = await store();
    events.append({
      eventId: "evt_context_pending_01",
      projectId,
      runId: "run_unmanaged_abcdef0123456789abcdef01",
      sessionId: "ses_unmanaged_abcdef0123456789abcdef01",
      type: "terminal.context.prepared",
      occurredAt: "2026-08-24T00:00:00Z",
      actor: { kind: "provider", provider: "claude" },
      schemaVersion: 1,
      policyVersion,
      payload: {
        observationId: "tobs_context_pending_01",
        executionMode: "unmanaged",
        providerSessionDigest: sessionDigest,
        providerTurnDigest: null,
        sourceSnapshotId: `ksnap_${"d".repeat(24)}`,
        repositoryRevision: `sha256:${"9".repeat(64)}`,
        queryDigest: `sha256:${"e".repeat(64)}`,
        contextHash: `sha256:${"f".repeat(64)}`,
        recommendationCount: 0,
        loadedDocuments: [],
        workstreamId: null,
        workstreamRevision: null,
        workstreamSnapshotHash: null,
        workstreamScope: null,
        workstreamDeliveredByteCount: null,
      },
    });
    const report = createTerminalCoverageReport({ projectId, events });
    expect(report.reports[0]).toMatchObject({
      capabilities: { explicitOutputReference: "unavailable" },
      coverage: { explicitReference: { value: null, reason: "turn_not_observed" } },
      completion: { result: "not_observed", lifecycleStatus: "not_observed" },
    });
    events.close();
  });
});
