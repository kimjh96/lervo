import {
  ConversationChangeLoop,
  type ConversationChangeLoopOptions,
} from "./conversation-change-loop.js";
export type { ConversationChangeSchedule as ConversationInteractionRetrySchedule } from "./conversation-change-loop.js";

export function reportConversationInteractionRetryFailure(
  error: unknown,
  onError?: (error: Error) => void,
): void {
  const failure = error instanceof Error ? error : new Error("The interaction retry cycle failed.");
  if (onError === undefined) {
    process.stderr.write(`Lervo Discord interaction retry failed: ${failure.message}\n`);
  } else {
    onError(failure);
  }
}

export class ConversationInteractionRetryLoop extends ConversationChangeLoop {
  constructor(
    options: Omit<ConversationChangeLoopOptions, "intervalMs"> & { intervalMs?: number },
  ) {
    super({ ...options, intervalMs: options.intervalMs ?? 2_000, continueOnFailure: true });
  }
}
