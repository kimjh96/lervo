import { readConversationControlMessage } from "@lervo/conversation-control";
import type { ConversationContextTurn } from "@lervo/conversation-responder";
import {
  enqueueInstructionCapture,
  requestKnowledgeResidentCycle,
} from "@lervo/repository-knowledge-runtime";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

/**
 * The conversation half of ADR-0467 owner-turn capture (the ADR-0457 `conversation_decision`
 * source). A configured human participant's message, with the agent reply that preceded it, is
 * queued for the knowledge resident's semantic assessment. Nothing here classifies the text or
 * calls a provider, and nothing is recorded as an event; the managed turn is never delayed by it.
 */
export interface ConversationOwnerTurnCapturePort {
  capture(input: {
    event: ConversationInboundEvent;
    priorTurns: readonly ConversationContextTurn[];
    respondingAgentId: string | null;
  }): Promise<void>;
}

export function createConversationOwnerTurnCapture(options: {
  repositoryRoot: string;
  artifactStore: ArtifactStore;
  now?: () => Date;
}): ConversationOwnerTurnCapturePort {
  return {
    async capture(input) {
      if (input.event.actor.kind !== "human") return;
      try {
        const ownerTurn = await readConversationControlMessage({
          artifactStore: options.artifactStore,
          event: input.event,
        });
        const preceding = [...input.priorTurns].reverse().find((turn) => turn.role === "assistant");
        await enqueueInstructionCapture({
          repositoryRoot: options.repositoryRoot,
          source: "conversation",
          provider: null,
          ownerTurn,
          precedingAgentTurn: preceding?.text ?? null,
          conversation: {
            conversationEventId: input.event.eventId,
            agentId: input.respondingAgentId,
          },
          now: (options.now ?? (() => new Date()))(),
        });
        // ADR-0606: the queue appends no event, so the resident is asked to look at it.
        await requestKnowledgeResidentCycle(options.repositoryRoot);
      } catch {
        // A failed queue write loses only this capture; the conversation turn continues.
      }
    },
  };
}
