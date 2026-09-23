import { createHash, randomUUID } from "node:crypto";

import type {
  RepositoryWorkProvider,
  RepositoryWorkReasoningEffort,
} from "@lervo/adapter-contract";
import type { EventDraftV2 } from "@lervo/event-contract";
import { assertManagedRepositoryKnowledgeCurrent } from "@lervo/managed-provider-host";
import { openProjectStorage } from "@lervo/project-storage";
import { lintRepositoryKnowledge } from "@lervo/repository-knowledge";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import { MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS } from "@lervo/schemas";

import {
  createVerifiedConversationWorkMemoryDraft,
  prepareConversationWorkMemory,
} from "./conversation-agent-memory.js";
import { resolveConversationRepositoryWorkKnowledgeDisposition } from "./conversation-repository-work-knowledge.js";
import type { RepositoryWorkChange } from "./repository-work-observation.js";

export interface ConversationRepositoryWorkCompletionBaseline {
  workstreamId: string | null;
  workstreamRevision: number | null;
  knowledgeCurrent: boolean;
}

export class ConversationRepositoryWorkCompletionError extends Error {
  constructor(
    readonly code:
      | "repository_work_checkpoint_missing"
      | "repository_work_knowledge_incomplete"
      | "repository_changed_path_limit_exceeded",
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
  const [current, knowledgeCurrent] = await Promise.all([
    readCurrentWorkstreamState(repositoryRoot),
    managedKnowledgeIsCurrent(repositoryRoot),
  ]);
  return {
    workstreamId: current?.snapshot.workstreamId ?? null,
    workstreamRevision: current?.snapshot.revision ?? null,
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
  repositoryChange: RepositoryWorkChange;
  sourceConversationEventId: string;
  workerAgentId: string;
  providerSessionId: string;
  requestedModel: string | null;
  requestedReasoningEffort: RepositoryWorkReasoningEffort | null;
  executionProfile: "routine" | "reasoning" | "review" | null;
  allocationReason:
    "session_continuity" | "bound_agent_provider" | "profile_preference" | "configured_default";
  requestContentHash: string;
  result: { contentHash: string; byteCount: number; summary: string };
  completedAt: string;
  replicaConfigured: boolean;
  checkpointDisposition: "not_needed" | "provider_checkpoint" | "host_checkpoint" | "not_observed";
}): Promise<void> {
  const changedPaths = input.repositoryChange.changedPaths;
  if (changedPaths.length > MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS) {
    throw new ConversationRepositoryWorkCompletionError(
      "repository_changed_path_limit_exceeded",
      "Repository work changed more paths than one exact completion event can attest.",
    );
  }
  const current = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    current === null ||
    (input.baseline.workstreamId !== null &&
      current.snapshot.workstreamId !== input.baseline.workstreamId) ||
    (changedPaths.length > 0 &&
      input.baseline.workstreamRevision !== null &&
      current.snapshot.revision <= input.baseline.workstreamRevision)
  ) {
    throw new ConversationRepositoryWorkCompletionError(
      "repository_work_checkpoint_missing",
      changedPaths.length > 0
        ? "Repository work changed bytes without advancing the exact current workstream."
        : "Repository work completed without an exact current workstream.",
    );
  }
  let knowledgeDisposition: "current" | "baseline_valid";
  try {
    knowledgeDisposition = await resolveConversationRepositoryWorkKnowledgeDisposition({
      changedPathCount: changedPaths.length,
      baselineKnowledgeCurrent: input.baseline.knowledgeCurrent,
      assertCurrent: () => assertManagedRepositoryKnowledgeCurrent(input.repositoryRoot),
      lintIsValid: async () => (await lintRepositoryKnowledge(input.repositoryRoot)).valid,
    });
  } catch (error) {
    throw new ConversationRepositoryWorkCompletionError(
      "repository_work_knowledge_incomplete",
      "Repository work left knowledge migration, normalization, or lint incomplete.",
      { cause: error },
    );
  }
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const coordinate = sha256(input.sourceConversationEventId).slice("sha256:".length, 31);
    const alreadyRecorded = storage.events
      .list({ runId: `run_conversation_${coordinate}`, limit: 1_000 })
      .find(
        (event) =>
          event.type === "conversation.repository_work.completed" &&
          event.payload.sourceConversationEventId === input.sourceConversationEventId &&
          event.payload.repositoryRevisionAfter === input.repositoryChange.repositoryRevisionAfter,
      );
    const preparedMemory = await prepareConversationWorkMemory({
      artifacts: storage.artifacts,
      summary: input.result.summary,
      changedPaths,
    });
    const payload = {
      sourceConversationEventId: input.sourceConversationEventId,
      workerAgentId: input.workerAgentId,
      providerSessionDigest: sha256(`${input.provider}\0${input.providerSessionId}`),
      requestedModel: input.requestedModel,
      requestedReasoningEffort: input.requestedReasoningEffort,
      executionProfile: input.executionProfile,
      allocationReason: input.allocationReason,
      requestContentHash: input.requestContentHash,
      resultContentHash: input.result.contentHash,
      resultByteCount: input.result.byteCount,
      repositoryRevisionBefore: input.repositoryChange.repositoryRevisionBefore,
      repositoryRevisionAfter: input.repositoryChange.repositoryRevisionAfter,
      changedPaths: [...changedPaths].sort(),
      changedPathCount: changedPaths.length,
      workstreamId: current.snapshot.workstreamId,
      workstreamRevision: current.snapshot.revision,
      workstreamSnapshotHash: current.contentHash,
      knowledgeDisposition,
      checkpointDisposition: input.checkpointDisposition,
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
