import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, expect, it } from "vitest";

import {
  reconcileInterruptedConversationRepositoryWork,
  recoverConversationRepositoryWorkCompletion,
} from "../src/conversation-repository-work-recovery.js";
import { SQLiteConversationRepositoryWorkStore } from "../src/conversation-repository-work-store.js";
import {
  availablePort,
  nodeRuntimeFixture,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(async () => {
  await removeTemporaryRoots();
});

it("recovers only the exact verified canonical completion after interruption", async () => {
  const fixtureRoot = await temporaryRoot();
  const fixture = await nodeRuntimeFixture(fixtureRoot, await availablePort());
  const root = fixture.repositoryRoot;
  const sourceConversationEventId = `cve_${"1".repeat(64)}`;
  const coordinate = createHash("sha256")
    .update(sourceConversationEventId)
    .digest("hex")
    .slice(0, 24);
  const requestContentHash = `sha256:${"2".repeat(64)}`;
  const resultContentHash = `sha256:${"3".repeat(64)}`;
  const storage = await openProjectStorage(root);
  try {
    storage.events.append({
      eventId: `evt_${"4".repeat(32)}`,
      projectId: storage.manifest.projectId,
      runId: `run_conversation_${coordinate}`,
      sessionId: `ses_conversation_${coordinate}`,
      type: "conversation.repository_work.completed",
      occurredAt: "2026-09-23T00:01:00.000Z",
      actor: { kind: "agent", provider: "codex" },
      schemaVersion: 2,
      policyVersion: `sha256:${"5".repeat(64)}`,
      payload: {
        sourceConversationEventId,
        workerAgentId: `agt_${"6".repeat(24)}`,
        providerSessionDigest: `sha256:${"7".repeat(64)}`,
        requestedModel: "gpt-5.6-sol",
        requestedReasoningEffort: "high",
        executionProfile: "reasoning",
        allocationReason: "profile_preference",
        requestContentHash,
        resultContentHash,
        resultByteCount: 47,
        repositoryRevisionBefore: `sha256:${"8".repeat(64)}`,
        repositoryRevisionAfter: `sha256:${"8".repeat(64)}`,
        changedPaths: [],
        changedPathCount: 0,
        workstreamId: `wks_${"9".repeat(24)}`,
        workstreamRevision: 1,
        workstreamSnapshotHash: `sha256:${"a".repeat(64)}`,
        knowledgeDisposition: "baseline_valid",
        checkpointDisposition: "not_needed",
        replicaDisposition: "not_configured",
        verificationStatus: "passed",
        completedAt: "2026-09-23T00:01:00.000Z",
      },
    });
  } finally {
    await storage.close();
  }

  await expect(
    recoverConversationRepositoryWorkCompletion({
      repositoryRoot: root,
      sourceConversationEventId,
      workerAgentId: `agt_${"6".repeat(24)}`,
      provider: "codex",
      requestContentHash,
    }),
  ).resolves.toEqual({
    completedAt: "2026-09-23T00:01:00.000Z",
    result: { contentHash: resultContentHash, byteCount: 47 },
  });
  await expect(
    recoverConversationRepositoryWorkCompletion({
      repositoryRoot: root,
      sourceConversationEventId,
      workerAgentId: `agt_${"6".repeat(24)}`,
      provider: "codex",
      requestContentHash: `sha256:${"b".repeat(64)}`,
    }),
  ).rejects.toMatchObject({ code: "repository_work_recovery_invalid" });

  const localStore = SQLiteConversationRepositoryWorkStore.open(
    resolve(fixtureRoot, "repository-work.sqlite"),
  );
  try {
    localStore.begin({
      eventId: sourceConversationEventId,
      conversationId: "cnv_example",
      threadId: null,
      workerId: `agt_${"6".repeat(24)}`,
      provider: "codex",
      requestContentHash,
      startedAt: "2026-09-23T00:00:00.000Z",
    });
    await expect(
      reconcileInterruptedConversationRepositoryWork({ repositoryRoot: root, store: localStore }),
    ).resolves.toBe(1);
    expect(
      localStore.begin({
        eventId: sourceConversationEventId,
        conversationId: "cnv_example",
        threadId: null,
        workerId: `agt_${"6".repeat(24)}`,
        provider: "codex",
        requestContentHash,
        startedAt: "2026-09-23T00:00:00.000Z",
      }),
    ).toMatchObject({
      completed: { contentHash: resultContentHash, byteCount: 47 },
    });
  } finally {
    localStore.close();
  }
});
