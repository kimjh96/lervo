import type { OutcomeSupervisionCycleResult } from "@lervo/orchestrator";
import { ConversationChangeLoop } from "./conversation-change-loop.js";

/** Deadlines are reconstructed by the cycle from durable duties; this timer owns no task state. */
export function createSupervisionChangeLoop(input: {
  runCycle(): Promise<OutcomeSupervisionCycleResult>;
  subscribe(notify: () => void): () => void;
  nextAuthorityCheckAt(): number | null;
  onFailure(error: unknown): void;
  onCycle?(result: OutcomeSupervisionCycleResult): void | Promise<void>;
}) {
  let deadline: number | null = null;
  return new ConversationChangeLoop({
    intervalMs: 5_000,
    continueOnFailure: true,
    subscribe: input.subscribe,
    onFailure: input.onFailure,
    runCycle: async () => {
      const result = await input.runCycle();
      if (result.report !== null)
        deadline =
          result.report.nextCheckAt === null ? null : Date.parse(result.report.nextCheckAt);
      await input.onCycle?.(structuredClone(result));
    },
    nextWakeupAt: () => {
      const candidates = [deadline, input.nextAuthorityCheckAt()].filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );
      return candidates.length === 0 ? null : Math.min(...candidates);
    },
  });
}
