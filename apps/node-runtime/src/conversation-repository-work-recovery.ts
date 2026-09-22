import { createHash } from "node:crypto";

import type { RepositoryWorkProvider } from "@lervo/adapter-contract";
import { openProjectStorage } from "@lervo/project-storage";
import type { ConversationRepositoryWorkCompletedEventPayload } from "@lervo/schemas";

import type { SQLiteConversationRepositoryWorkStore } from "./conversation-repository-work-store.js";

export interface RecoveredConversationRepositoryWorkCompletion {
  completedAt: string;
  result: { contentHash: string; byteCount: number };
}

export class ConversationRepositoryWorkRecoveryError extends Error {
  readonly code = "repository_work_recovery_invalid";

  constructor(message: string) {
    super(message);
    this.name = "ConversationRepositoryWorkRecoveryError";
  }
}

/** Recovers only a verified canonical completion for the exact interrupted conversation turn. */
export async function recoverConversationRepositoryWorkCompletion(input: {
  repositoryRoot: string;
  sourceConversationEventId: string;
  workerAgentId: string;
  provider: RepositoryWorkProvider;
  requestContentHash: string;
}): Promise<RecoveredConversationRepositoryWorkCompletion | null> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const coordinate = createHash("sha256")
      .update(input.sourceConversationEventId)
      .digest("hex")
      .slice(0, 24);
    const matches = storage.events
      .list({ runId: `run_conversation_${coordinate}`, limit: 1_000 })
      .filter(
        (event) =>
          event.type === "conversation.repository_work.completed" &&
          event.payload.sourceConversationEventId === input.sourceConversationEventId,
      );
    if (matches.length === 0) return null;
    if (matches.length !== 1) {
      throw new ConversationRepositoryWorkRecoveryError(
        "The interrupted conversation turn has conflicting canonical completions.",
      );
    }
    const completion = matches[0]!;
    const payload = completion.payload as ConversationRepositoryWorkCompletedEventPayload;
    if (
      completion.actor.kind !== "agent" ||
      completion.actor.provider !== input.provider ||
      payload.workerAgentId !== input.workerAgentId ||
      payload.requestContentHash !== input.requestContentHash ||
      payload.verificationStatus !== "passed"
    ) {
      throw new ConversationRepositoryWorkRecoveryError(
        "The canonical completion differs from the interrupted conversation turn.",
      );
    }
    return {
      completedAt: payload.completedAt,
      result: {
        contentHash: payload.resultContentHash,
        byteCount: payload.resultByteCount,
      },
    };
  } finally {
    await storage.close();
  }
}

/** Repairs restart-interrupted local projections without replaying work or publishing a message. */
export async function reconcileInterruptedConversationRepositoryWork(input: {
  repositoryRoot: string;
  store: SQLiteConversationRepositoryWorkStore;
}): Promise<number> {
  let reconciled = 0;
  for (const turn of input.store.interruptedTurns()) {
    const completion = await recoverConversationRepositoryWorkCompletion({
      repositoryRoot: input.repositoryRoot,
      sourceConversationEventId: turn.eventId,
      workerAgentId: turn.workerId,
      provider: turn.provider,
      requestContentHash: turn.requestContentHash,
    });
    if (completion === null) continue;
    input.store.reconcileCompletion({
      ...turn,
      result: completion.result,
      completedAt: completion.completedAt,
    });
    reconciled += 1;
  }
  return reconciled;
}
