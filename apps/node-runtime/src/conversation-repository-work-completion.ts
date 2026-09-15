import { createHash, randomUUID } from "node:crypto";

import type {
  RepositoryWorkProvider,
  RepositoryWorkReasoningEffort,
} from "@lervo/adapter-contract";
import type { EventDraftV2 } from "@lervo/event-contract";
import { assertManagedRepositoryKnowledgeCurrent } from "@lervo/managed-provider-host";
import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import { lintRepositoryKnowledge } from "@lervo/repository-knowledge";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";

import {
  createVerifiedConversationWorkMemoryDraft,
  prepareConversationWorkMemory,
} from "./conversation-agent-memory.js";

export interface ConversationRepositoryWorkCompletionBaseline {
  workstreamId: string | null;
  workstreamRevision: number | null;
  repositoryRevision: string;
  knowledgeCurrent: boolean;
}

export class ConversationRepositoryWorkCompletionError extends Error {
  constructor(
    readonly code: "repository_work_checkpoint_missing" | "repository_work_knowledge_incomplete",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationRepositoryWorkCompletionError";
  }
}

export async function captureConversationRepositoryWorkCompletionBaseline(
  repositoryRoot: string,
): Promise<ConversationRepositoryWorkCompletionBaseline> {
  const [current, repository, knowledgeCurrent] = await Promise.all([
    readCurrentWorkstreamState(repositoryRoot),
    captureRepositorySnapshot(repositoryRoot),
    managedKnowledgeIsCurrent(repositoryRoot),
  ]);
  return {
    workstreamId: current?.snapshot.workstreamId ?? null,
    workstreamRevision: current?.snapshot.revision ?? null,
    repositoryRevision: repository.revision,
    knowledgeCurrent,
  };
}

async function managedKnowledgeIsCurrent(repositoryRoot: string): Promise<boolean> {
  try {
    await assertManagedRepositoryKnowledgeCurrent(repositoryRoot);
    return true;
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const CONVERSATION_REPOSITORY_WORK_POLICY_VERSION = sha256(
  "lervo.conversation.repository-work-completion.v1",
);

export async function verifyConversationRepositoryWorkCompletion(input: {
  repositoryRoot: string;
  provider: RepositoryWorkProvider;
  baseline: ConversationRepositoryWorkCompletionBaseline;
  changedPaths: readonly string[];
  sourceConversationEventId: string;
  workerAgentId: string;
  providerSessionId: string;
  requestedModel: string | null;
  requestedReasoningEffort: RepositoryWorkReasoningEffort | null;
  requestContentHash: string;
  result: { contentHash: string; byteCount: number; summary: string };
  completedAt: string;
  replicaConfigured: boolean;
}): Promise<void> {
  const current = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    current === null ||
    (input.baseline.workstreamId !== null &&
      current.snapshot.workstreamId !== input.baseline.workstreamId) ||
    (input.changedPaths.length > 0 &&
      input.baseline.workstreamRevision !== null &&
      current.snapshot.revision <= input.baseline.workstreamRevision)
  ) {
    throw new ConversationRepositoryWorkCompletionError(
      "repository_work_checkpoint_missing",
      input.changedPaths.length > 0
        ? "Repository work changed bytes without advancing the exact current workstream."
        : "Repository work completed without an exact current workstream.",
    );
  }
  const repository = await captureRepositorySnapshot(input.repositoryRoot);
  let knowledgeDisposition: "current" | "baseline_valid";
  try {
    await assertManagedRepositoryKnowledgeCurrent(input.repositoryRoot);
    knowledgeDisposition = "current";
  } catch (error) {
    const lint = await lintRepositoryKnowledge(input.repositoryRoot);
    if (!input.baseline.knowledgeCurrent && lint.valid) {
      knowledgeDisposition = "baseline_valid";
    } else {
      throw new ConversationRepositoryWorkCompletionError(
        "repository_work_knowledge_incomplete",
        "Repository work left knowledge migration, normalization, or lint incomplete.",
        { cause: error },
      );
    }
  }
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const alreadyRecorded = storage.events
      .list()
      .find(
        (event) =>
          event.type === "conversation.repository_work.completed" &&
          event.payload.sourceConversationEventId === input.sourceConversationEventId &&
          event.payload.repositoryRevisionAfter === repository.revision,
      );
    const preparedMemory = await prepareConversationWorkMemory({
      artifacts: storage.artifacts,
      summary: input.result.summary,
      changedPaths: input.changedPaths,
    });
    const coordinate = sha256(input.sourceConversationEventId).slice("sha256:".length, 31);
    const payload = {
      sourceConversationEventId: input.sourceConversationEventId,
      workerAgentId: input.workerAgentId,
      providerSessionDigest: sha256(`${input.provider}\0${input.providerSessionId}`),
      requestedModel: input.requestedModel,
      requestedReasoningEffort: input.requestedReasoningEffort,
      requestContentHash: input.requestContentHash,
      resultContentHash: input.result.contentHash,
      resultByteCount: input.result.byteCount,
      repositoryRevisionBefore: input.baseline.repositoryRevision,
      repositoryRevisionAfter: repository.revision,
      changedPaths: [...input.changedPaths].sort().slice(0, 64),
      changedPathCount: input.changedPaths.length,
      workstreamId: current.snapshot.workstreamId,
      workstreamRevision: current.snapshot.revision,
      workstreamSnapshotHash: current.contentHash,
      knowledgeDisposition,
      replicaDisposition: input.replicaConfigured ? "current" : "not_configured",
      verificationStatus: "passed",
      completedAt: input.completedAt,
    } as const;
    const draft: EventDraftV2 = {
      eventId: `evt_${randomUUID().replaceAll("-", "")}`,
      projectId: storage.manifest.projectId,
      runId: `run_conversation_${coordinate}`,
      sessionId: `ses_conversation_${coordinate}`,
      type: "conversation.repository_work.completed",
      occurredAt: input.completedAt,
      actor: { kind: "agent", provider: input.provider },
      schemaVersion: 2,
      policyVersion: CONVERSATION_REPOSITORY_WORK_POLICY_VERSION,
      payload,
    };
    if (alreadyRecorded !== undefined) {
      storage.events.append(
        createVerifiedConversationWorkMemoryDraft({
          projectId: storage.manifest.projectId,
          completion: alreadyRecorded,
          workerAgentId: input.workerAgentId,
          prepared: preparedMemory,
        }),
      );
    } else {
      storage.events.transact((transaction) => {
        const completion = transaction.append(draft).event;
        transaction.append(
          createVerifiedConversationWorkMemoryDraft({
            projectId: storage.manifest.projectId,
            completion,
            workerAgentId: input.workerAgentId,
            prepared: preparedMemory,
          }),
        );
      });
    }
  } finally {
    await storage.close();
  }
}
