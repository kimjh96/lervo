import type { ConversationApplication } from "@lervo/conversation-app";

import { ConversationChangeLoop } from "./conversation-change-loop.js";
import type { ConversationDiscussionRuntime } from "./conversation-discussion-runtime.js";

/** Dispatches durable discussion deadlines through the ordinary verified interaction pipeline. */
export class ConversationDiscussionDeadlineLoop extends ConversationChangeLoop {
  constructor(input: {
    integrationId: string;
    application: ConversationApplication;
    discussion: ConversationDiscussionRuntime;
    onFailure(error: unknown): void;
    onChangeSignal?(failure: unknown): void;
    intervalMs?: number;
  }) {
    super({
      intervalMs: input.intervalMs ?? 2_000,
      continueOnFailure: true,
      // ADR-0602: a discussion write wakes the loop, so it waits on the next deadline alone.
      subscribe: (notify) => input.discussion.subscribeChanges(notify),
      nextWakeupAt: () => input.discussion.nextDeadlineAt(),
      ...(input.onChangeSignal === undefined ? {} : { onChangeSignal: input.onChangeSignal }),
      runCycle: async () => {
        for (const event of input.discussion.deadlineEvents()) {
          await input.application.handleInboundEvent!(event);
          await input.application.runDeliveryCycle?.(input.integrationId);
        }
      },
      onFailure: input.onFailure,
    });
  }
}
