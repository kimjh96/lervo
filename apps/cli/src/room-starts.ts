// Conversations an agent started that have not opened yet (Lervo ADE rooms, "How an agent starts
// a conversation"): host-local, owner-only state beside the hosted launch records. Each holds the
// first turn until the conversation's session opens from it, then nothing holds it but the
// provider's transcript.
import { dirname, resolve } from "node:path";

import { readPrivateJsonFile, writePrivateJsonFile } from "@lervo/repository-knowledge-runtime";

import { hostedLaunchRecordsPath } from "./hosted-launch-records.js";

/** The pending starts kept at once; the oldest is dropped past it. */
export const PENDING_START_LIMIT = 16;
/** How long a start waits for its agent's turn to end before it is dropped. */
export const PENDING_START_MS = 60 * 60 * 1000;
/** How many conversations one agent may start in an hour, a loop guard, not an approval. */
export const AGENT_STARTS_PER_HOUR = 4;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface PendingStart {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly title: string;
  readonly text: string;
  readonly preparedAt: string;
}

/** Where pending starts live: beside the hosted launch records. */
export function pendingStartsPath(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(dirname(hostedLaunchRecordsPath(environment)), "room-starts.json");
}

function isStart(value: unknown): value is PendingStart {
  const start = value as Partial<PendingStart> | null;
  return (
    typeof start?.workspaceId === "string" &&
    typeof start.agentId === "string" &&
    typeof start.title === "string" &&
    typeof start.text === "string" &&
    typeof start.preparedAt === "string"
  );
}

/** The kept starts younger than an hour at `now`. */
async function readStarts(path: string, now: Date): Promise<PendingStart[]> {
  const file = await readPrivateJsonFile(path, MAX_FILE_BYTES);
  if (file.status !== "read") return [];
  const starts = (file.value as { starts?: unknown }).starts;
  return (Array.isArray(starts) ? starts.filter(isStart) : []).filter(
    (start) => now.getTime() - Date.parse(start.preparedAt) < PENDING_START_MS,
  );
}

/** Adds `start`, keeping the newest {@link PENDING_START_LIMIT}. */
export async function recordPendingStart(
  path: string,
  start: PendingStart,
  now = new Date(),
): Promise<void> {
  const starts = [...(await readStarts(path, now)), start].slice(-PENDING_START_LIMIT);
  await writePrivateJsonFile(path, { schemaVersion: 1, starts });
}

/** The starts of `agentId` still waiting, oldest first. */
export async function pendingStartsOf(
  path: string,
  agentId: string,
  now = new Date(),
): Promise<PendingStart[]> {
  return (await readStarts(path, now)).filter((start) => start.agentId === agentId);
}

/** The waiting start of `agentId` in `workspaceId`, or null when there is none. */
export async function pendingStart(
  path: string,
  workspaceId: string,
  agentId: string,
  now = new Date(),
): Promise<PendingStart | null> {
  return (
    (await readStarts(path, now)).find(
      (start) => start.workspaceId === workspaceId && start.agentId === agentId,
    ) ?? null
  );
}

/** Drops the start of `agentId` in `workspaceId`, once its session opened or it failed. */
export async function dropPendingStart(
  path: string,
  workspaceId: string,
  agentId: string,
  now = new Date(),
): Promise<void> {
  const starts = await readStarts(path, now);
  const kept = starts.filter(
    (start) => start.workspaceId !== workspaceId || start.agentId !== agentId,
  );
  if (kept.length !== starts.length)
    await writePrivateJsonFile(path, { schemaVersion: 1, starts: kept });
}
