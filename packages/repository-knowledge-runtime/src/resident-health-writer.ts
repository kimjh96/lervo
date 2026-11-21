import { EARLIER_WRITER_REFRESH_MILLISECONDS, heldRepositoryPresence } from "./held-presence.js";
import { recordKnowledgeResidentHealth, type KnowledgeResidentState } from "./resident-health.js";

/** A failed health write retries after a second, doubling to this ceiling. */
const HEALTH_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

/**
 * ADR-0602: a resident's health row, written only when its state changes, with the process
 * presence that readers probe to prove it runs. A failed write retries with backoff, since
 * nothing rewrites an unchanged state. Mixed versions only: while a resident of an earlier
 * release, which removes rows by heartbeat age, shares the table, the row is rewritten within
 * that age.
 */
export function residentHealthWriter(input: {
  repositoryRoot: string;
  workerId: string;
  signal: AbortSignal;
  onFailure: (error: unknown) => void;
}): {
  report(state: KnowledgeResidentState, reason: string | null): void;
  state(): KnowledgeResidentState;
  reason(): string | null;
  settled(): Promise<void>;
  stop(): Promise<void>;
} {
  const presence = heldRepositoryPresence(input.repositoryRoot);
  let state: KnowledgeResidentState = "idle";
  let reason: string | null = null;
  let writing: Promise<void> = Promise.resolve();
  let written: string | null = null;
  let failures = 0;
  let retry: NodeJS.Timeout | null = null;
  let refresh: NodeJS.Timeout | null = null;
  const write = () => {
    const key = `${state}\0${reason ?? ""}`;
    if (key === written) return;
    written = key;
    const at = { state, reason };
    writing = writing
      .then(() => presence.token())
      .then((token) =>
        recordKnowledgeResidentHealth({
          repositoryRoot: input.repositoryRoot,
          workerId: input.workerId,
          state: at.state,
          reason: at.reason,
          presence: token,
        }),
      )
      .then(
        (outcome) => {
          failures = 0;
          if (outcome?.earlierWriters === true && refresh === null && !input.signal.aborted) {
            refresh = setTimeout(() => {
              refresh = null;
              written = null;
              write();
            }, EARLIER_WRITER_REFRESH_MILLISECONDS);
            refresh.unref();
          }
        },
        (error: unknown) => {
          written = null;
          input.onFailure(error);
          if (input.signal.aborted || retry !== null) return;
          failures = Math.min(failures + 1, 64);
          retry = setTimeout(
            () => {
              retry = null;
              if (!input.signal.aborted) write();
            },
            Math.min(HEALTH_RETRY_CEILING_MILLISECONDS, 1_000 * 2 ** (failures - 1)),
          );
          retry.unref();
        },
      );
  };
  return {
    report: (next, nextReason) => {
      state = next;
      reason = nextReason;
      write();
    },
    state: () => state,
    reason: () => reason,
    settled: () => writing,
    stop: async () => {
      if (retry !== null) clearTimeout(retry);
      if (refresh !== null) clearTimeout(refresh);
      state = "stopped";
      reason = null;
      written = null;
      write();
      await writing;
      await presence.release();
    },
  };
}
