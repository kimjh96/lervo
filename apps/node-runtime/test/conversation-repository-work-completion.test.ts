import { randomUUID } from "node:crypto";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyWorkstreamStartPlan,
  createWorkstreamStartPlan,
} from "@lervo/repository-knowledge/workstream";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureConversationRepositoryWorkPendingBaseline,
  verifyConversationRepositoryWorkCompletion,
} from "../src/conversation-repository-work-completion.js";
import { reconcileConversationKnowledgeOutbox } from "../src/conversation-knowledge-outbox-reconciliation.js";
import { readConversationKnowledgeJobSource } from "../src/conversation-knowledge-job-source.js";
import { prepareRepositoryWorkSourceManifest } from "../src/repository-work-source-manifest.js";
import {
  availablePort,
  nodeRuntimeFixture,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(async () => {
  await removeTemporaryRoots();
});

async function currentRepository(): Promise<string> {
  const fixture = await nodeRuntimeFixture(await temporaryRoot(), await availablePort(), {
    eventSchemaVersion: 3,
  });
  const storage = await openProjectStorage(fixture.repositoryRoot);
  try {
    const now = new Date("2026-09-23T00:00:00.000Z");
    const plan = await createWorkstreamStartPlan({
      repositoryRoot: fixture.repositoryRoot,
      projectId: storage.manifest.projectId,
      draft: {
        schemaVersion: 1,
        status: "active",
        title: "Conversation work",
        objective: "Complete a source-bound conversation turn.",
        nextActions: ["Review the source-bound result."],
        blockers: [],
        notes: [],
        references: [],
        updatedAt: now.toISOString(),
      },
    });
    await applyWorkstreamStartPlan({
      plan,
      now,
      actor: "agent",
      recordApplied: async (applied, snapshotContent) => {
        const artifact = await storage.artifacts.put(snapshotContent);
        const identity = randomUUID().replaceAll("-", "");
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: applied.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "workstream.snapshot.recorded",
          occurredAt: applied.appliedAt,
          actor: { kind: "agent", provider: "codex" },
          schemaVersion: 1,
          policyVersion: artifact.contentHash,
          payload: {
            workstreamId: applied.workstreamId,
            revision: applied.revision,
            status: applied.status,
            changeKind: applied.operation,
            snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
            snapshotContentHash: artifact.contentHash,
            previousSnapshotContentHash: applied.previousSnapshotContentHash,
            sourceArtifactId: null,
            sourceContentHash: null,
            recordedAt: applied.appliedAt,
          },
        });
      },
    });
  } finally {
    await storage.close();
  }
  return fixture.repositoryRoot;
}

describe("conversation repository work completion", () => {
  it("rejects incomplete changed-path evidence before opening repository storage", async () => {
    await expect(
      verifyConversationRepositoryWorkCompletion({
        repositoryRoot: "/nonexistent/repository",
        provider: "codex",
        baseline: { workstreamId: null, workstreamRevision: null, knowledgeCurrent: false },
        repositoryChange: {
          repositoryRevisionBefore: `sha256:${"a".repeat(64)}`,
          repositoryRevisionAfter: `sha256:${"b".repeat(64)}`,
          changedPaths: Array.from({ length: 65 }, (_, index) => `src/change-${index}.ts`),
        },
        sourceConversationEventId: "cve_source",
        workerAgentId: "agt_worker",
        providerSessionId: "session",
        requestedModel: null,
        requestedReasoningEffort: null,
        executionProfile: null,
        allocationReason: "configured_default",
        requestContentHash: `sha256:${"c".repeat(64)}`,
        result: { contentHash: `sha256:${"d".repeat(64)}`, byteCount: 1, summary: "done" },
        completedAt: "2026-09-23T00:00:00.000Z",
        replicaConfigured: false,
        checkpointDisposition: "not_observed",
      }),
    ).rejects.toMatchObject({ code: "repository_changed_path_limit_exceeded" });
  });

  it("records a content-bound pending completion and rebuilds its job without a global knowledge scan", async () => {
    const repositoryRoot = await currentRepository();
    const baseline = await captureConversationRepositoryWorkPendingBaseline(repositoryRoot);
    expect(baseline).toMatchObject({ workstreamRevision: 1, knowledgeCurrent: false });
    const repositoryChange = {
      repositoryRevisionBefore: `sha256:${"a".repeat(64)}`,
      repositoryRevisionAfter: `sha256:${"b".repeat(64)}`,
      changedPaths: ["README.md"],
    };
    const sourceManifest = prepareRepositoryWorkSourceManifest({
      before: {
        head: "1".repeat(40),
        paths: new Map(),
        revision: repositoryChange.repositoryRevisionBefore,
      },
      after: {
        head: "1".repeat(40),
        paths: new Map([["README.md", `file:33188:${"2".repeat(64)}`]]),
        revision: repositoryChange.repositoryRevisionAfter,
      },
      change: repositoryChange,
    });
    const storage = await openProjectStorage(repositoryRoot);
    const result = await storage.artifacts.put("done");
    await storage.close();
    const input = {
      repositoryRoot,
      provider: "codex" as const,
      baseline: { ...baseline, workstreamRevision: null },
      repositoryChange,
      sourceConversationEventId: `cve_${"3".repeat(64)}`,
      workerAgentId: `agt_${"4".repeat(24)}`,
      providerSessionId: "session",
      requestedModel: "gpt-6-sol",
      requestedReasoningEffort: "high" as const,
      executionProfile: "reasoning" as const,
      allocationReason: "profile_preference" as const,
      requestContentHash: `sha256:${"5".repeat(64)}`,
      result: { contentHash: result.contentHash, byteCount: result.byteCount, summary: "done" },
      completedAt: "2026-09-23T00:01:00.000Z",
      replicaConfigured: false,
      checkpointDisposition: "provider_checkpoint" as const,
      knowledgeMode: "pending_background" as const,
      sourceManifest,
    };
    await verifyConversationRepositoryWorkCompletion(input);
    await verifyConversationRepositoryWorkCompletion(input);
    await expect(
      verifyConversationRepositoryWorkCompletion({ ...input, sourceManifest: undefined }),
    ).rejects.toMatchObject({ code: "repository_work_knowledge_incomplete" });
    await expect(
      verifyConversationRepositoryWorkCompletion({
        ...input,
        result: { ...input.result, contentHash: `sha256:${"f".repeat(64)}` },
      }),
    ).rejects.toMatchObject({ code: "repository_work_knowledge_incomplete" });
    const reopened = await openProjectStorage(repositoryRoot);
    try {
      const completions = reopened.events
        .list({ limit: 100 })
        .filter((event) => event.type === "conversation.repository_work.completed");
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({
        schemaVersion: 3,
        payload: {
          knowledgeDisposition: "pending_background",
          sourceManifestContentHash: sourceManifest.contentHash,
          sourceManifestByteCount: sourceManifest.content.byteLength,
        },
      });
      expect(
        await readConversationKnowledgeJobSource({
          completion: completions[0]!,
          artifacts: reopened.artifacts,
        }),
      ).toEqual(sourceManifest.manifest);
      await expect(
        readConversationKnowledgeJobSource({
          completion: completions[0]!,
          artifacts: {
            get: async () => {
              throw new Error("private storage failure");
            },
          } as never,
        }),
      ).rejects.toMatchObject({ code: "knowledge_job_source_unavailable" });
      await expect(
        readConversationKnowledgeJobSource({
          completion: completions[0]!,
          artifacts: { get: async () => Buffer.from("wrong manifest") } as never,
        }),
      ).rejects.toMatchObject({ code: "knowledge_job_source_invalid" });
      const manifestBytes = await reopened.artifacts.get(
        `lervo-cas://sha256/${sourceManifest.contentHash.slice(7)}`,
      );
      expect(Buffer.from(manifestBytes)).toEqual(Buffer.from(sourceManifest.content));
      const first = reconcileConversationKnowledgeOutbox({
        events: reopened.events,
        afterSeq: 0,
        now: input.completedAt,
      });
      expect(first.enqueuedCount).toBe(1);
      expect(
        reconcileConversationKnowledgeOutbox({
          events: reopened.events,
          afterSeq: 0,
          now: input.completedAt,
        }).enqueuedCount,
      ).toBe(0);
    } finally {
      await reopened.close();
    }
  });

  it("records unchanged work without a new knowledge job or a false current claim", async () => {
    const repositoryRoot = await currentRepository();
    const baseline = await captureConversationRepositoryWorkPendingBaseline(repositoryRoot);
    const storage = await openProjectStorage(repositoryRoot);
    const result = await storage.artifacts.put("No repository change.");
    await storage.close();
    await verifyConversationRepositoryWorkCompletion({
      repositoryRoot,
      provider: "codex",
      baseline,
      repositoryChange: {
        repositoryRevisionBefore: `sha256:${"a".repeat(64)}`,
        repositoryRevisionAfter: `sha256:${"a".repeat(64)}`,
        changedPaths: [],
      },
      sourceConversationEventId: `cve_${"6".repeat(64)}`,
      workerAgentId: `agt_${"7".repeat(24)}`,
      providerSessionId: "session",
      requestedModel: null,
      requestedReasoningEffort: null,
      executionProfile: null,
      allocationReason: "configured_default",
      requestContentHash: `sha256:${"8".repeat(64)}`,
      result: {
        contentHash: result.contentHash,
        byteCount: result.byteCount,
        summary: "No repository change.",
      },
      completedAt: "2026-09-23T00:01:00.000Z",
      replicaConfigured: false,
      checkpointDisposition: "not_needed",
      knowledgeMode: "pending_background",
    });
    const reopened = await openProjectStorage(repositoryRoot);
    try {
      const completion = reopened.events
        .list({ limit: 100 })
        .find((event) => event.type === "conversation.repository_work.completed");
      expect(completion?.payload).toMatchObject({ knowledgeDisposition: "not_applicable" });
      expect(
        reconcileConversationKnowledgeOutbox({
          events: reopened.events,
          afterSeq: 0,
          now: "2026-09-23T00:01:01.000Z",
        }).enqueuedCount,
      ).toBe(0);
    } finally {
      await reopened.close();
    }
  });
});
