import { expect, it, vi } from "vitest";
import {
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";
import { hasCanonicalNormalizationLineage } from "../src/canonical-normalization-lineage.js";
import {
  carriedParkedSources,
  withParkedSourcesStatus,
  KNOWLEDGE_SOURCES_PARKED,
} from "../src/convergence-parking.js";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { convergenceEvaluationContract } from "../src/evaluation-contract.js";
import { settledCanonicalDispositions } from "../src/canonical-disposition-ledger.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { retentionFixture, finishRetention } from "./cas-retention-fixture.js";

vi.mock("../src/baseline.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  cycleScopedConvergenceDiscovery: () => async () => ({}),
}));

it("preserves historical normalization lineage, parked carry/status and settled-stall reevaluation after collection; absent ledger inputs require assessment", async () => {
  const f = await retentionFixture();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T00:00:00Z"));
  try {
    const before = sha256("before");
    const after = sha256("after");
    const state: KnowledgeConvergenceInput = {
      schemaVersion: 1,
      obligationId: "lineage",
      snapshotHash: sha256("snapshot"),
      receipts: [],
      stageData: {},
      baseline: {
        schemaVersion: 1,
        projectId: f.storage.manifest.projectId,
        sourceSnapshotId: "snap",
        sourceSnapshotHash: sha256("snapshot"),
        policyHash: sha256("policy"),
        debtDigest: sha256("debt"),
        delegationHash: sha256("delegation"),
        debtCounts: { canonicalization: 0, normalization: 0, lifecycle: 0, historical: 0 },
        sources: [{ path: "docs/a.md", kind: "text", contentHash: after }],
        normalizationPaths: [],
        historicalEvents: [],
      },
    };
    const proof = await f.put({
      obligationId: state.obligationId,
      stage: "normalization_apply",
      resultSnapshotHash: state.snapshotHash,
      delegationHash: state.baseline.delegationHash,
      approvedEffects: [{ path: "docs/a.md", beforeHash: before, afterHash: after }],
      proof: {
        receipt: { operation: "normalize_documents", updated: ["docs/a.md"], created: [] },
        review: { reviewerAgentId: "reviewer" },
        verification: ["checked"],
      },
    });
    const normalized = {
      ...state,
      receipts: [
        {
          stage: "normalization_apply",
          artifactHash: proof.contentHash,
          snapshotHash: state.snapshotHash,
        },
      ],
      stageData: {
        settledAssignment: {
          agentId: "generator",
          assignmentId: "assignment",
          status: "completed",
        },
      },
    };
    const result = await f.put(normalized);
    let previous = f.event("repository.knowledge.baseline.requested", {
      obligationId: state.obligationId,
      inputArtifactHash: result.contentHash,
    });
    const original = previous;
    previous = f.event("repository.knowledge.stage.recorded", {
      obligationId: state.obligationId,
      predecessorEventId: previous.eventId,
      predecessorEventHash: previous.eventHash,
      stage: "normalization_apply",
      state: "current",
      assignmentId: "assignment",
      snapshotHash: state.snapshotHash,
      resultArtifactHash: result.contentHash,
    });
    const dependency = await f.put({
      code: "knowledge_stage_failure_unclassified",
      evaluationContract: convergenceEvaluationContract(),
      reevaluateAt: "2026-01-01T00:00:00Z",
    });
    previous = f.event("repository.knowledge.stage.recorded", {
      obligationId: state.obligationId,
      predecessorEventId: previous.eventId,
      predecessorEventHash: previous.eventHash,
      stage: "lifecycle_verification",
      state: "attention_required",
      dependencyHash: dependency.contentHash,
    });
    f.event("repository.knowledge.convergence.recorded", {
      obligationId: state.obligationId,
      originalEventId: original.eventId,
      originalEventHash: original.eventHash,
      terminalState: "attention_required",
    });
    const ledger = await f.settled("ledger");
    // The ledger explicitly permits absent private inputs after retention.
    f.event("repository.knowledge.baseline.requested", {
      obligationId: "ledger-history",
      inputArtifactHash: ledger.obsolete.contentHash,
    });
    f.event("repository.knowledge.stage.recorded", {
      obligationId: "ledger-history",
      stage: "canonical_integration",
      state: "current",
      inputArtifactHash: ledger.obsolete.contentHash,
    });
    f.event("repository.knowledge.stage.recorded", {
      obligationId: "ledger-history",
      stage: "lifecycle_verification",
      state: "current",
      resultArtifactHash: ledger.kept.contentHash,
    });
    f.event("repository.knowledge.convergence.recorded", {
      obligationId: "ledger-history",
      terminalState: "superseded",
    });
    const parkedSource = {
      stage: "normalization",
      path: "docs/a.md",
      contentHash: after,
      reason: "owner_decision",
      attempts: 1,
      reasons: ["Owner decision needed."],
    };
    const parked = await f.put({ code: KNOWLEDGE_SOURCES_PARKED, sources: [parkedSource] });
    const baseline = f.event("repository.knowledge.baseline.requested", {
      obligationId: "parked",
      inputArtifactHash: result.contentHash,
    });
    f.event("repository.knowledge.stage.recorded", {
      obligationId: "parked",
      predecessorEventId: baseline.eventId,
      predecessorEventHash: baseline.eventHash,
      stage: "lifecycle_verification",
      state: "attention_required",
      failureCode: KNOWLEDGE_SOURCES_PARKED,
      dependencyHash: parked.contentHash,
    });
    expect(await finishRetention(f.storage)).toMatchObject({
      status: "collected",
    });
    const context: ConvergenceRuntimeContext = {
      storage: f.storage,
      provider: "codex",
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSource: () => {},
    };
    expect(await hasCanonicalNormalizationLineage(context, state, "docs/a.md", before, after)).toBe(
      true,
    );
    expect(await carriedParkedSources(f.storage, state)).toEqual([parkedSource]);
    const status = { reason: KNOWLEDGE_SOURCES_PARKED } as KnowledgeConvergenceStatus;
    // Use a narrow active replay after the unrelated ledger history was removed by its owner.
    const parkedHistory = f.history.filter((event) => event.payload.obligationId === "parked");
    const activeEvents = {
      ...f.storage.events,
      list: (options: { afterSeq?: number; limit?: number } = {}) =>
        parkedHistory
          .filter((event) => event.seq > (options.afterSeq ?? 0))
          .slice(0, options.limit ?? 1000),
    };
    expect(
      await withParkedSourcesStatus({ artifacts: f.artifacts, events: activeEvents }, status),
    ).toMatchObject({ parked: { count: 1, sources: [{ path: "docs/a.md", attempts: 1 }] } });
    expect(
      await createConvergenceRuntimeHost(context).dependencyCurrent(dependency.contentHash),
    ).toBe(false);
    expect(await f.artifacts.has(ledger.obsolete.uri)).toBe(false);
    await expect(
      settledCanonicalDispositions({
        repositoryRoot: f.root,
        events: f.storage.events,
        artifacts: f.artifacts,
        projectId: f.storage.manifest.projectId,
        policyHash: state.baseline.policyHash,
        sources: [{ path: "docs/a.md", contentHash: after }],
      }),
    ).resolves.toEqual([]);
  } finally {
    vi.restoreAllMocks();
    await f.dispose();
  }
});
