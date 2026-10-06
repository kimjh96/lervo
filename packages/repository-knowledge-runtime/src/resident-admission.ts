import { recordKnowledgeResidentHealth } from "./resident-health.js";

/** The event writer schema the ADR-0466/0469 resident appends (owner lease, continuity). */
export const KNOWLEDGE_RESIDENT_EVENT_SCHEMA_VERSION = 4;

/** How often a held resident refreshes its heartbeat; well inside the 120-second health window. */
export const KNOWLEDGE_RESIDENT_HOLD_HEARTBEAT_MILLISECONDS = 60_000;

/**
 * ADR-0470: why a resident that should run for a checkout cannot start yet. A held resident is
 * never silent: it heartbeats `attention` with this reason so the doctor, attention, and status
 * report the cause instead of an absent resident.
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
 * Keeps a held resident's private heartbeat current until stopped. The heartbeat proves only that
 * a host process intends to serve the checkout and why it cannot; it claims no knowledge work.
 */
export function startKnowledgeResidentHold(input: {
  repositoryRoot: string;
  workerId: string;
  reason: KnowledgeResidentHoldReason;
  onFailure: (error: unknown) => void;
  heartbeatMilliseconds?: number;
  record?: typeof recordKnowledgeResidentHealth;
}): () => Promise<void> {
  const record = input.record ?? recordKnowledgeResidentHealth;
  let writing: Promise<void> = Promise.resolve();
  const beat = (state: "attention" | "stopped") => {
    writing = writing
      .then(() =>
        record({
          repositoryRoot: input.repositoryRoot,
          workerId: input.workerId,
          state,
          reason: state === "attention" ? input.reason : null,
        }),
      )
      .catch(input.onFailure);
    return writing;
  };
  void beat("attention");
  const timer = setInterval(
    () => void beat("attention"),
    input.heartbeatMilliseconds ?? KNOWLEDGE_RESIDENT_HOLD_HEARTBEAT_MILLISECONDS,
  );
  let stopped: Promise<void> | null = null;
  return () => {
    stopped ??= (async () => {
      clearInterval(timer);
      await beat("stopped");
    })();
    return stopped;
  };
}
