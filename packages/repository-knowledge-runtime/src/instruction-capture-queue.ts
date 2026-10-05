import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import {
  MAXIMUM_CAPTURED_AGENT_TURN_BYTES,
  MAXIMUM_CAPTURED_OWNER_TURN_BYTES,
  sha256,
  stableId,
  type InstructionCaptureSurface,
} from "@lervo/repository-knowledge";

/**
 * The only place owner-turn text rests (ADR-0467): a private, Git-ignored, short-lived queue the
 * terminal hook and the conversation runtime write and the knowledge resident drains. Records are
 * 0600 files in 0700 directories, expire after a day, and are deleted as soon as they are
 * assessed. Events never carry this text; they carry `promptDigest` only.
 */
export const INSTRUCTION_CAPTURE_ROOT = ".lervo/state/knowledge/instruction-capture";
export const INSTRUCTION_CAPTURE_QUEUE_ROOT = `${INSTRUCTION_CAPTURE_ROOT}/queue`;
const AGENT_TURN_ROOT = `${INSTRUCTION_CAPTURE_ROOT}/agent-turns`;

export const MAXIMUM_QUEUED_CAPTURES = 32;
export const CAPTURE_RETENTION_MILLISECONDS = 24 * 3_600_000;
const MAXIMUM_AGENT_TURN_SLOTS = 16;
const AGENT_TURN_RETENTION_MILLISECONDS = 6 * 3_600_000;
const MAXIMUM_RECORD_BYTES = 64 * 1024;
const CAPTURE_ID = /^kcap_[a-f0-9]{24}$/u;
const SESSION_KEY = /^[a-f0-9]{24}$/u;

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
}

/** Keeps the tail of a UTF-8 string within a byte bound without splitting a code point. */
export function boundedUtf8Tail(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  let start = bytes.byteLength - maximumBytes;
  while (start < bytes.byteLength && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

async function ensureDirectory(root: string, relative: string): Promise<string> {
  let directory = resolve(root);
  for (const part of relative.split("/")) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const observed = await lstat(directory);
    if (!observed.isDirectory() || observed.isSymbolicLink())
      throw new Error("The instruction capture state directory is invalid.");
  }
  return directory;
}

async function writePrivate(root: string, directory: string, name: string, value: unknown) {
  const base = await ensureDirectory(root, directory);
  const temporary = resolve(base, `.capture-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(base, name));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readPrivate(path: string): Promise<unknown> {
  try {
    const observed = await lstat(path);
    if (!observed.isFile() || observed.size > MAXIMUM_RECORD_BYTES) return null;
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
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
    (item.attempts ?? -1) >= 0
  );
}

export type InstructionCaptureEnqueueResult =
  | { status: "queued" | "already_queued"; captureId: string }
  | { status: "skipped"; reason: "empty_turn" | "turn_too_large" };

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
  const existing = await listQueuedInstructionCaptures(input.repositoryRoot);
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

/** Records one more failed assessment attempt; the caller drops the record at its ceiling. */
export async function recordInstructionCaptureAttempt(
  repositoryRoot: string,
  capture: QueuedInstructionCapture,
): Promise<QueuedInstructionCapture> {
  const next = { ...capture, attempts: capture.attempts + 1 };
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
    if (Date.parse(capture.expiresAt) > now.getTime()) continue;
    await removeQueuedInstructionCapture(repositoryRoot, capture.captureId);
    expired += 1;
  }
  const slots = resolve(repositoryRoot, AGENT_TURN_ROOT);
  try {
    for (const name of await readdir(slots)) {
      const value = (await readPrivate(resolve(slots, name))) as { recordedAt?: unknown } | null;
      const recordedAt = typeof value?.recordedAt === "string" ? Date.parse(value.recordedAt) : NaN;
      if (!(now.getTime() - recordedAt < AGENT_TURN_RETENTION_MILLISECONDS))
        await rm(resolve(slots, name), { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return expired;
}

function sessionKey(provider: "codex" | "claude", providerSessionId: string): string {
  return sha256(`${provider}\0${providerSessionId}`).slice("sha256:".length, "sha256:".length + 24);
}

/**
 * Keeps the latest agent reply of one terminal session so the next owner turn is assessed with
 * it: an implicit correction only makes sense against what the agent just said. One bounded slot
 * per session, overwritten each turn, expiring after six hours.
 */
export async function recordPrecedingAgentTurn(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  agentTurn: string | null;
  now: Date;
}): Promise<void> {
  const key = sessionKey(input.provider, input.providerSessionId);
  const directory = resolve(input.repositoryRoot, AGENT_TURN_ROOT);
  if (input.agentTurn === null || input.agentTurn.trim() === "") {
    await rm(resolve(directory, `${key}.json`), { force: true });
    return;
  }
  let names: string[] = [];
  try {
    names = (await readdir(directory)).filter((name) => name !== `${key}.json`).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (names.length >= MAXIMUM_AGENT_TURN_SLOTS) {
    const aged = await Promise.all(
      names.map(async (name) => ({
        name,
        modified: await stat(resolve(directory, name)).then(
          (observed) => observed.mtimeMs,
          () => 0,
        ),
      })),
    );
    aged.sort((left, right) => left.modified - right.modified);
    for (const entry of aged.slice(0, names.length - MAXIMUM_AGENT_TURN_SLOTS + 1))
      await rm(resolve(directory, entry.name), { force: true });
  }
  await writePrivate(input.repositoryRoot, AGENT_TURN_ROOT, `${key}.json`, {
    schemaVersion: 1,
    text: boundedUtf8Tail(input.agentTurn, MAXIMUM_CAPTURED_AGENT_TURN_BYTES),
    recordedAt: input.now.toISOString(),
  });
}

export async function readPrecedingAgentTurn(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  now: Date;
}): Promise<string | null> {
  const key = sessionKey(input.provider, input.providerSessionId);
  if (!SESSION_KEY.test(key)) return null;
  const value = (await readPrivate(
    resolve(input.repositoryRoot, AGENT_TURN_ROOT, `${key}.json`),
  )) as { schemaVersion?: unknown; text?: unknown; recordedAt?: unknown } | null;
  if (
    value?.schemaVersion !== 1 ||
    typeof value.text !== "string" ||
    typeof value.recordedAt !== "string" ||
    !(input.now.getTime() - Date.parse(value.recordedAt) < AGENT_TURN_RETENTION_MILLISECONDS)
  )
    return null;
  return value.text;
}
