import type { WorkforceAssignmentKnowledgeJobProvenance } from "@lervo/agent-workforce";

import {
  ConversationKnowledgeLeaseError,
  type LeasedConversationKnowledgeJob,
} from "./conversation-knowledge-lease.js";

/** Binds a separate background agent to the exact source-bearing completion. */
export function conversationKnowledgeAssignmentProvenance(input: {
  job: LeasedConversationKnowledgeJob;
  agentId: string;
}): WorkforceAssignmentKnowledgeJobProvenance {
  const { completion, jobId } = input.job;
  const sourceConversationEventId = completion.payload.sourceConversationEventId;
  const sourceManifestHash = completion.payload.sourceManifestContentHash;
  if (
    completion.schemaVersion !== 3 ||
    completion.payload.knowledgeDisposition !== "pending_background" ||
    typeof sourceConversationEventId !== "string" ||
    typeof sourceManifestHash !== "string"
  )
    throw new ConversationKnowledgeLeaseError(
      "knowledge_job_completion_invalid",
      "The review source does not match a source-bound completion.",
    );
  return {
    contractVersion: 1,
    jobId,
    completionEventId: completion.eventId,
    completionEventHash: completion.eventHash,
    sourceConversationEventId,
    sourceManifestHash,
    agentId: input.agentId,
  };
}
