import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  RepositoryWorkProvider,
  RepositoryWorkReasoningEffort,
} from "@lervo/adapter-contract";
import type { EventDraft } from "@lervo/event-contract";
import { assertManagedRepositoryKnowledgeCurrent } from "@lervo/managed-provider-host";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import { MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS } from "@lervo/schemas";
import { appendRepositoryChange } from "@lervo/repository-knowledge";
import { readRepositoryKnowledgeJobAdmission } from "@lervo/repository-knowledge-runtime";
import { collectRunEventsBounded } from "@lervo/storage-contract";

import {
  createVerifiedConversationWorkMemoryDraft,
  prepareConversationWorkMemory,
} from "./conversation-agent-memory.js";
import {
  conversationRepositoryChangeEventId,
  planConversationRepositoryChange,
} from "./conversation-repository-change.js";
import { prepareConversationRepositoryWorkKnowledgeEvidence } from "./conversation-repository-work-knowledge-evidence.js";
import { conversationRepositoryWorkCoordinates } from "./conversation-repository-work-measurement.js";
import type { RepositoryWorkChange } from "./repository-work-observation.js";
import type { PreparedRepositoryWorkSourceManifest } from "./repository-work-source-manifest.js";

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

/** Captures only the live-turn checkpoint coordinate; knowledge is owned by the background lane. */
export async function captureConversationRepositoryWorkPendingBaseline(
  repositoryRoot: string,
): Promise<ConversationRepositoryWorkCompletionBaseline> {
  const current = await readCurrentWorkstreamState(repositoryRoot);
  return {
    workstreamId: current?.snapshot.workstreamId ?? null,
    workstreamRevision: current?.snapshot.revision ?? null,
    knowledgeCurrent: false,
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
const CONVERSATION_REPOSITORY_WORK_ASYNC_POLICY_VERSION = sha256(
  "lervo.conversation.repository-work-completion.v2",
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
  knowledgeMode?: "synchronous" | "pending_background";
  sourceManifest?: PreparedRepositoryWorkSourceManifest | undefined;
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
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    let knowledgeEvidence;
    try {
      knowledgeEvidence = await prepareConversationRepositoryWorkKnowledgeEvidence({
        repositoryRoot: input.repositoryRoot,
        artifacts: storage.artifacts,
        baselineKnowledgeCurrent: input.baseline.knowledgeCurrent,
        repositoryChange: input.repositoryChange,
        mode: input.knowledgeMode ?? "synchronous",
        ...(input.sourceManifest === undefined ? {} : { sourceManifest: input.sourceManifest }),
      });
    } catch (error) {
      throw new ConversationRepositoryWorkCompletionError(
        "repository_work_knowledge_incomplete",
        "Repository-work knowledge evidence could not be established.",
        { cause: error },
      );
    }
    const { disposition: knowledgeDisposition, sourceManifestArtifact } = knowledgeEvidence;
    const coordinates = conversationRepositoryWorkCoordinates(input.sourceConversationEventId);
    const recordedCompletions = collectRunEventsBounded({
      events: storage.events,
      runId: coordinates.runId,
      maximumEvents: 1_000,
    }).filter(
      (event) =>
        event.type === "conversation.repository_work.completed" &&
        event.payload.sourceConversationEventId === input.sourceConversationEventId,
    );
    if (recordedCompletions.length > 1) {
      throw new ConversationRepositoryWorkCompletionError(
        "repository_work_knowledge_incomplete",
        "The conversation turn has conflicting canonical repository-work completions.",
      );
    }
    const alreadyRecorded = recordedCompletions[0];
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
      ...(sourceManifestArtifact === null
        ? {}
        : {
            sourceManifestContentHash: sourceManifestArtifact.contentHash,
            sourceManifestByteCount: sourceManifestArtifact.byteCount,
          }),
      checkpointDisposition: input.checkpointDisposition,
      replicaDisposition: input.replicaConfigured ? "current" : "not_configured",
      verificationStatus: "passed",
      completedAt: input.completedAt,
    } as const;
    const draft: EventDraft = {
      eventId: `evt_${sha256(`lervo.conversation.repository-work-completed.v1\0${input.sourceConversationEventId}`).slice(7, 39)}`,
      projectId: storage.manifest.projectId,
      runId: coordinates.runId,
      sessionId: coordinates.sessionId,
      type: "conversation.repository_work.completed",
      occurredAt: input.completedAt,
      actor: { kind: "agent", provider: input.provider },
      schemaVersion: input.knowledgeMode === "pending_background" ? 3 : 2,
      policyVersion:
        input.knowledgeMode === "pending_background"
          ? CONVERSATION_REPOSITORY_WORK_ASYNC_POLICY_VERSION
          : CONVERSATION_REPOSITORY_WORK_POLICY_VERSION,
      payload,
    };
    if (alreadyRecorded !== undefined) {
      if (
        alreadyRecorded.schemaVersion !== draft.schemaVersion ||
        alreadyRecorded.actor.kind !== "agent" ||
        alreadyRecorded.actor.provider !== input.provider ||
        !isDeepStrictEqual(alreadyRecorded.payload, payload)
      ) {
        throw new ConversationRepositoryWorkCompletionError(
          "repository_work_knowledge_incomplete",
          "The existing canonical completion differs from this repository work result.",
        );
      }
      storage.events.append(
        createVerifiedConversationWorkMemoryDraft({
          projectId: storage.manifest.projectId,
          completion: alreadyRecorded,
          workerAgentId: input.workerAgentId,
          prepared: preparedMemory,
        }),
      );
    } else {
      // ADR-0433: a background-knowledge turn queues its change unit with the completion.
      const change =
        input.knowledgeMode === "pending_background" &&
        input.sourceManifest !== undefined &&
        (storage.writableEventSchemaVersion ?? 1) >= 3
          ? await planConversationRepositoryChange({
              projectId: storage.manifest.projectId,
              repositoryRoot: input.repositoryRoot,
              artifacts: storage.artifacts,
              sourceManifest: input.sourceManifest,
              completionEventId: draft.eventId,
              completedAt: input.completedAt,
            })
          : null;
      // ADR-0605: only a host that runs knowledge jobs receives one.
      const admission =
        change === null ? null : await readRepositoryKnowledgeJobAdmission(input.repositoryRoot);
      storage.events.transact((transaction) => {
        const completion = transaction.append(draft).event;
        if (change !== null && admission !== null)
          appendRepositoryChange(
            transaction,
            {
              eventId: conversationRepositoryChangeEventId(draft.eventId),
              projectId: draft.projectId,
              runId: draft.runId,
              sessionId: draft.sessionId,
              occurredAt: input.completedAt,
              actor: { kind: "system" },
              policyVersion: CONVERSATION_REPOSITORY_WORK_ASYNC_POLICY_VERSION,
            },
            change,
            admission,
          );
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
