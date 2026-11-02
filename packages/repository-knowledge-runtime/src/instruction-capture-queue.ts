import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  MAXIMUM_CAPTURED_AGENT_TURN_BYTES,
  MAXIMUM_CAPTURED_OWNER_TURN_BYTES,
  sha256,
  stableId,
  type InstructionCaptureSurface,
} from "@lervo/repository-knowledge";

import { pruneExpiredAgentTurns } from "./instruction-capture-agent-turn.js";
import {
  boundedUtf8Tail,
  INSTRUCTION_CAPTURE_ROOT,
  readPrivate,
  writePrivate,
} from "./instruction-capture-private-file.js";

// Stable facade: callers keep importing the capture root, text bound, and agent-turn store here.
export { boundedUtf8Tail, INSTRUCTION_CAPTURE_ROOT } from "./instruction-capture-private-file.js";
export {
  readPrecedingAgentTurn,
  recordPrecedingAgentTurn,
} from "./instruction-capture-agent-turn.js";

/**
 * The only place owner-turn text rests (ADR-0467): a private, Git-ignored, short-lived queue the
 * terminal hook and the conversation runtime write and the knowledge resident drains. Records are
 * 0600 files in 0700 directories, expire after a day, and are deleted as soon as they are
 * assessed. Events never carry this text; they carry `promptDigest` only.
 */
export const INSTRUCTION_CAPTURE_QUEUE_ROOT = `${INSTRUCTION_CAPTURE_ROOT}/queue`;

export const MAXIMUM_QUEUED_CAPTURES = 32;
export const MAXIMUM_RETAINED_CAPTURES = 32;
export const CAPTURE_RETENTION_MILLISECONDS = 24 * 3_600_000;
const MAXIMUM_RETRY_DELAY_MILLISECONDS = 24 * 3_600_000;
const CAPTURE_ID = /^kcap_[a-f0-9]{24}$/u;

export interface QueuedInstructionCapture {
  schemaVersion: 1;
  captureId: string;
  source: InstructionCaptureSurface;
  provider: "codex" | "claude" | null;
  ownerTurn: string;
  precedingAgentTurn: string | null;
  /** sha256 of the owner turn; the only coordinate events may carry. */
  promptDigest: string;
  conversation: { conversationEventId: string; agentId: string | null } | null;
  enqueuedAt: string;
  expiresAt: string;
  attempts: number;
  /**
   * ADR-0561: an explicitly submitted owner rule whose grounding or fidelity check could not
   * finish. It never expires, is never evicted, and is retried with backoff until it is stored.
   */
  retained?: true;
  /** The earliest retry time of a retained record after a failed attempt. */
  nextAttemptAt?: string;
  /**
   * ADR-0561: the independent cross-check rejected this turn's first normalization. The turn
   * regenerates once with these reasons as evidence; a second disagreement holds it as debt.
   */
  crossCheckDisagreement?: { reasonIds: string[] };
}

function validCapture(value: unknown): value is QueuedInstructionCapture {
  const item = value as Partial<QueuedInstructionCapture> | null;
  return (
    item !== null &&
    typeof item === "object" &&
    item.schemaVersion === 1 &&
    typeof item.captureId === "string" &&
    CAPTURE_ID.test(item.captureId) &&
    (item.source === "terminal_prompt" || item.source === "conversation") &&
    typeof item.ownerTurn === "string" &&
    item.ownerTurn.trim() !== "" &&
    Buffer.byteLength(item.ownerTurn) <= MAXIMUM_CAPTURED_OWNER_TURN_BYTES &&
    (item.precedingAgentTurn === null ||
      (typeof item.precedingAgentTurn === "string" &&
        Buffer.byteLength(item.precedingAgentTurn) <= MAXIMUM_CAPTURED_AGENT_TURN_BYTES)) &&
    item.promptDigest === sha256(item.ownerTurn) &&
    typeof item.enqueuedAt === "string" &&
    Number.isFinite(Date.parse(item.enqueuedAt)) &&
    typeof item.expiresAt === "string" &&
    Number.isFinite(Date.parse(item.expiresAt)) &&
    Number.isSafeInteger(item.attempts) &&
    (item.attempts ?? -1) >= 0 &&
    (item.retained === undefined || item.retained === true) &&
    (item.nextAttemptAt === undefined ||
      (typeof item.nextAttemptAt === "string" &&
        Number.isFinite(Date.parse(item.nextAttemptAt)))) &&
    (item.crossCheckDisagreement === undefined ||
      (typeof item.crossCheckDisagreement === "object" &&
        item.crossCheckDisagreement !== null &&
        Array.isArray(item.crossCheckDisagreement.reasonIds) &&
        item.crossCheckDisagreement.reasonIds.length <= 8 &&
        item.crossCheckDisagreement.reasonIds.every(
          (reason) => typeof reason === "string" && reason.length <= 160,
        )))
  );
}

export type InstructionCaptureEnqueueResult =
  | { status: "queued" | "already_queued"; captureId: string }
  | { status: "skipped"; reason: "empty_turn" | "turn_too_large" | "retained_queue_full" };

/**
 * Queues one owner turn for semantic assessment. It performs only bounded local file work, so it
 * fits the ADR-0451 hook budget; when the queue is full the oldest record is evicted, because a
 * newer owner turn is the more relevant one.
 */
export async function enqueueInstructionCapture(input: {
  repositoryRoot: string;
  source: InstructionCaptureSurface;
  provider: "codex" | "claude" | null;
  ownerTurn: string;
  precedingAgentTurn: string | null;
  conversation?: { conversationEventId: string; agentId: string | null } | null;
  /** Keep the record until it is settled (ADR-0561 explicit owner rules). */
  retained?: boolean;
  now: Date;
}): Promise<InstructionCaptureEnqueueResult> {
  if (input.ownerTurn.trim() === "") return { status: "skipped", reason: "empty_turn" };
  if (Buffer.byteLength(input.ownerTurn) > MAXIMUM_CAPTURED_OWNER_TURN_BYTES)
    return { status: "skipped", reason: "turn_too_large" };
  const precedingAgentTurn =
    input.precedingAgentTurn === null || input.precedingAgentTurn.trim() === ""
      ? null
      : boundedUtf8Tail(input.precedingAgentTurn, MAXIMUM_CAPTURED_AGENT_TURN_BYTES);
  const promptDigest = sha256(input.ownerTurn);
  const conversation = input.conversation ?? null;
  const captureId = stableId("kcap", {
    source: input.source,
    promptDigest,
    precedingDigest: precedingAgentTurn === null ? null : sha256(precedingAgentTurn),
    conversationEventId: conversation?.conversationEventId ?? null,
  });
  const name = `${captureId}.json`;
  const directory = resolve(input.repositoryRoot, INSTRUCTION_CAPTURE_QUEUE_ROOT);
  if (validCapture(await readPrivate(resolve(directory, name))))
    return { status: "already_queued", captureId };
  const all = await listQueuedInstructionCaptures(input.repositoryRoot);
  if (
    input.retained === true &&
    all.filter((capture) => capture.retained === true).length >= MAXIMUM_RETAINED_CAPTURES
  )
    return { status: "skipped", reason: "retained_queue_full" };
  const existing = all.filter((capture) => capture.retained !== true);
  if (input.retained !== true)
    for (const evicted of existing.slice(
      0,
      Math.max(0, existing.length - MAXIMUM_QUEUED_CAPTURES + 1),
    ))
      await removeQueuedInstructionCapture(input.repositoryRoot, evicted.captureId);
  const record: QueuedInstructionCapture = {
    schemaVersion: 1,
    captureId,
    source: input.source,
    provider: input.provider,
    ownerTurn: input.ownerTurn,
    precedingAgentTurn,
    promptDigest,
    conversation,
    enqueuedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + CAPTURE_RETENTION_MILLISECONDS).toISOString(),
    attempts: 0,
    ...(input.retained === true ? { retained: true as const } : {}),
  };
  await writePrivate(input.repositoryRoot, INSTRUCTION_CAPTURE_QUEUE_ROOT, name, record);
  return { status: "queued", captureId };
}

/** Readable queued captures, oldest first; malformed records are skipped, never repaired. */
export async function listQueuedInstructionCaptures(
  repositoryRoot: string,
): Promise<QueuedInstructionCapture[]> {
  const directory = resolve(repositoryRoot, INSTRUCTION_CAPTURE_QUEUE_ROOT);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => /^kcap_[a-f0-9]{24}\.json$/u.test(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: QueuedInstructionCapture[] = [];
  for (const name of names) {
    const value = await readPrivate(resolve(directory, name));
    if (validCapture(value) && `${value.captureId}.json` === name) records.push(value);
  }
  return records.sort(
    (left, right) =>
      left.enqueuedAt.localeCompare(right.enqueuedAt) ||
      left.captureId.localeCompare(right.captureId),
  );
}

export async function removeQueuedInstructionCapture(
  repositoryRoot: string,
  captureId: string,
): Promise<void> {
  if (!CAPTURE_ID.test(captureId)) throw new Error("The capture ID is invalid.");
  await rm(resolve(repositoryRoot, INSTRUCTION_CAPTURE_QUEUE_ROOT, `${captureId}.json`), {
    force: true,
  });
}

/**
 * Records one more failed assessment attempt. The caller drops an ordinary record at its ceiling;
 * a retained record waits an exponentially growing delay, at most a day, before its next attempt.
 */
export async function recordInstructionCaptureAttempt(
  repositoryRoot: string,
  capture: QueuedInstructionCapture,
  now: Date,
): Promise<QueuedInstructionCapture> {
  const attempts = capture.attempts + 1;
  const next: QueuedInstructionCapture = {
    ...capture,
    attempts,
    ...(capture.retained === true
      ? {
          nextAttemptAt: new Date(
            now.getTime() +
              Math.min(MAXIMUM_RETRY_DELAY_MILLISECONDS, 2 ** Math.min(attempts, 16) * 60_000),
          ).toISOString(),
        }
      : {}),
  };
  await writePrivate(
    repositoryRoot,
    INSTRUCTION_CAPTURE_QUEUE_ROOT,
    `${capture.captureId}.json`,
    next,
  );
  return next;
}

/**
 * ADR-0561: records the first cross-check disagreement, so the next cycle regenerates the turn
 * once with the reasons as evidence. It is not a failed attempt and does not consume one.
 */
export async function recordInstructionCaptureDisagreement(
  repositoryRoot: string,
  capture: QueuedInstructionCapture,
  reasonIds: readonly string[],
): Promise<QueuedInstructionCapture> {
  const next: QueuedInstructionCapture = {
    ...capture,
    crossCheckDisagreement: { reasonIds: reasonIds.slice(0, 8).map((id) => id.slice(0, 160)) },
  };
  await writePrivate(
    repositoryRoot,
    INSTRUCTION_CAPTURE_QUEUE_ROOT,
    `${capture.captureId}.json`,
    next,
  );
  return next;
}

/** Removes expired records and reports how many expired unassessed. */
export async function pruneInstructionCaptureQueue(
  repositoryRoot: string,
  now: Date,
): Promise<number> {
  let expired = 0;
  for (const capture of await listQueuedInstructionCaptures(repositoryRoot)) {
    if (capture.retained === true || Date.parse(capture.expiresAt) > now.getTime()) continue;
    await removeQueuedInstructionCapture(repositoryRoot, capture.captureId);
    expired += 1;
  }
  await pruneExpiredAgentTurns(repositoryRoot, now);
  return expired;
}
