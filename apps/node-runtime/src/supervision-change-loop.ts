import type { OutcomeSupervisionCycleResult } from "@lervo/orchestrator";
import { ConversationChangeLoop } from "./conversation-change-loop.js";

/** The settled source a lapsed deadline keeps re-evaluating: its digest and blocked state. */
type SettledSource = { digest: string; blocked: boolean };

/** Deadlines are reconstructed by the cycle from durable duties; this timer owns no task state. */
export function createSupervisionChangeLoop(input: {
  runCycle(): Promise<OutcomeSupervisionCycleResult>;
  subscribe(notify: () => void): () => void;
  nextAuthorityCheckAt(): number | null;
  onFailure(error: unknown): void;
  onCycle?(result: OutcomeSupervisionCycleResult): void | Promise<void>;
}) {
  let deadline: number | null = null;
  let settled: SettledSource | null = null;
  /**
   * True when the cycle left the source the cycle cursors remember unchanged: an unchanged skip,
   * or an idle or blocked evaluation of the same digest and blocked state as the previous one.
   */
  const leftSourceUnchanged = (result: OutcomeSupervisionCycleResult): boolean => {
    if (result.disposition !== "idle" && result.disposition !== "blocked") {
      settled = null;
      return false;
    }
    if (result.report === null) return true;
    const next = {
      digest: result.report.sourceRevisionDigest,
      blocked: result.disposition === "blocked",
    };
    const unchanged = settled?.digest === next.digest && settled.blocked === next.blocked;
    settled = next;
    return unchanged;
  };
  return new ConversationChangeLoop<boolean>({
    intervalMs: 5_000,
    continueOnFailure: true,
    // ADR-0602: an inactive workstream is a settled state: it waits for the event or the
    // workstream file change that can end it. Every other failure backs off from five seconds.
    failureRetryMs: (error) =>
      (error as { code?: unknown } | null)?.code === "supervision_workstream_inactive"
        ? null
        : 5_000,
    subscribe: input.subscribe,
    onFailure: input.onFailure,
    // ADR-0602: a lapsed progress deadline gets one more cycle, then waits for a change or a new
    // deadline; any event hint still wakes the owner at once, and every cycle re-reads authority
    // and expiry before an effect can run.
    runCycle: async () => {
      const result = await input.runCycle();
      if (result.report !== null)
        deadline =
          result.report.nextCheckAt === null ? null : Date.parse(result.report.nextCheckAt);
      const unchanged = leftSourceUnchanged(result);
      await input.onCycle?.(structuredClone(result));
      return unchanged;
    },
    nextWakeupAt: () => {
      const candidates = [deadline, input.nextAuthorityCheckAt()].filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );
      return candidates.length === 0 ? null : Math.min(...candidates);
    },
  });
}
