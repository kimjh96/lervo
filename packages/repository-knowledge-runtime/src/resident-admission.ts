import { EARLIER_WRITER_REFRESH_MILLISECONDS, heldRepositoryPresence } from "./held-presence.js";

import { recordKnowledgeResidentHealth } from "./resident-health.js";

/** A failed hold record retries after a second, doubling to this ceiling. */
const HOLD_RECORD_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

/** The event writer schema the ADR-0466/0469 resident appends (owner lease, continuity). */
export const KNOWLEDGE_RESIDENT_EVENT_SCHEMA_VERSION = 4;

/**
 * ADR-0470: why a resident that should run for a checkout cannot start yet. A held resident is
 * never silent: it records `attention` with this reason, and its process presence proves it holds,
 * so the doctor, attention, and status report the cause instead of an absent resident.
 */
export type KnowledgeResidentHoldReason = "event_schema_outdated";

/** Pure: null admits the resident; a reason holds it. */
export function knowledgeResidentHoldReason(
  writableEventSchemaVersion: number | undefined,
): KnowledgeResidentHoldReason | null {
  return (writableEventSchemaVersion ?? 1) < KNOWLEDGE_RESIDENT_EVENT_SCHEMA_VERSION
    ? "event_schema_outdated"
    : null;
}

/**
 * Records a held resident until stopped. ADR-0602: it writes once and holds its process presence,
 * which readers probe; it proves only that a host process intends to serve the checkout and why
 * it cannot, and claims no knowledge work.
 */
export function startKnowledgeResidentHold(input: {
  repositoryRoot: string;
  workerId: string;
  reason: KnowledgeResidentHoldReason;
  onFailure: (error: unknown) => void;
  record?: (
    input: Parameters<typeof recordKnowledgeResidentHealth>[0],
  ) => Promise<{ earlierWriters: boolean } | void>;
}): () => Promise<void> {
  const record = input.record ?? recordKnowledgeResidentHealth;
  const presence = heldRepositoryPresence(input.repositoryRoot);
  let writing: Promise<void> = Promise.resolve();
  let failures = 0;
  let retry: NodeJS.Timeout | null = null;
  let stopped: Promise<void> | null = null;
  const write = (state: "attention" | "stopped") => {
    writing = writing
      .then(() => presence.token())
      .then((token) =>
        record({
          repositoryRoot: input.repositoryRoot,
          workerId: input.workerId,
          state,
          reason: state === "attention" ? input.reason : null,
          presence: token,
        }),
      )
      .then(
        (outcome) => {
          failures = 0;
          // Mixed versions only: an earlier release's writer removes rows by heartbeat age.
          if (
            outcome?.earlierWriters === true &&
            state === "attention" &&
            stopped === null &&
            retry === null
          ) {
            retry = setTimeout(() => {
              retry = null;
              if (stopped === null) void write("attention");
            }, EARLIER_WRITER_REFRESH_MILLISECONDS);
            retry.unref();
          }
        },
        (error: unknown) => {
          input.onFailure(error);
          // ADR-0602: a lost write is retried once at a growing delay, since nothing rewrites it.
          if (state === "stopped" || stopped !== null) return;
          failures = Math.min(failures + 1, 64);
          retry = setTimeout(
            () => {
              retry = null;
              if (stopped === null) void write("attention");
            },
            Math.min(HOLD_RECORD_RETRY_CEILING_MILLISECONDS, 1_000 * 2 ** (failures - 1)),
          );
          retry.unref();
        },
      );
    return writing;
  };
  void write("attention");
  return () => {
    stopped ??= (async () => {
      if (retry !== null) clearTimeout(retry);
      await write("stopped");
      await presence.release();
    })();
    return stopped;
  };
}
